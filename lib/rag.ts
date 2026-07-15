/** Full RAG for Nomi's knowledge base — retrieve → augment → generate.
 *
 * Retrieval is HYBRID: semantic similarity from embeddings (so "throttling
 * requests" finds a passage about "rate limiting") blended with the existing
 * keyword overlap (so exact names and rare terms still win). Embeddings come
 * from Ollama's local `nomic-embed-text` first (local-first, ADR-5), then the
 * user's own Gemini key; when neither is reachable everything falls back to
 * pure keyword search, so retrieval never breaks.
 *
 * Vectors are computed once per passage and cached in chrome.storage.local
 * (`nomi:vecs`), re-embedded only when a doc changes. Every network call here
 * is a single stateless fetch, safe in the ephemeral MV3 worker (ADR-2).
 *
 * Pure math (cosine / hybridScore / rankHybrid) has no chrome imports and is
 * unit-tested in lib/__tests__/rag.test.ts.
 */

import {
  keywords,
  scorePassage,
  searchDocs,
  splitPassages,
  type DocHit,
  type NomiDoc,
} from './docs';
import { getSettings } from './settings';

export const OLLAMA_EMBED_MODEL = 'nomic-embed-text';
export const GEMINI_EMBED_MODEL = 'text-embedding-004';
const VECS_KEY = 'nomi:vecs';

// ---------- pure math ----------

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** 4-decimal quantization — cuts stored JSON size ~60% at no ranking cost. */
export function quantize(v: number[]): number[] {
  return v.map((x) => Math.round(x * 1e4) / 1e4);
}

/** Blend the two signals. Semantic similarity carries most of the weight;
 * keyword overlap (normalised: 3+ matched terms saturates) breaks ties and
 * carries the whole load when no embedder is available. */
export function hybridScore(sem: number, kw: number): number {
  return 0.65 * Math.max(0, sem) + 0.35 * Math.min(kw / 3, 1);
}

export interface RankedPassage {
  idx: number;
  score: number;
  sem: number;
  kw: number;
}

/** Rank passages by hybrid score. `passVecs[i]` may be null (not embedded);
 * a passage needs SOME real signal — decent similarity or a keyword hit —
 * to appear at all, so answers never ground on noise. */
export function rankHybrid(
  queryVec: number[] | null,
  passVecs: (number[] | null)[],
  kwScores: number[],
  limit = 5,
): RankedPassage[] {
  const out: RankedPassage[] = [];
  for (let i = 0; i < kwScores.length; i++) {
    const pv = queryVec ? passVecs[i] : null;
    const sem = pv ? cosine(queryVec!, pv) : 0;
    const kw = kwScores[i] ?? 0;
    if (sem < 0.35 && kw < 1) continue;
    out.push({ idx: i, score: hybridScore(sem, kw), sem, kw });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- embedding providers ----------

async function ollamaEmbed(texts: string[]): Promise<number[][] | null> {
  try {
    const res = await fetch('http://localhost:11434/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    const vecs = data.embeddings;
    return Array.isArray(vecs) && vecs.length === texts.length ? vecs : null;
  } catch {
    return null;
  }
}

async function geminiEmbed(texts: string[], apiKey: string): Promise<number[][] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:batchEmbedContents?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map((t) => ({
            model: `models/${GEMINI_EMBED_MODEL}`,
            content: { parts: [{ text: t.slice(0, 8000) }] },
          })),
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: { values?: number[] }[] };
    const vecs = (data.embeddings ?? []).map((e) => e?.values);
    return vecs.length === texts.length && vecs.every(Array.isArray)
      ? (vecs as number[][])
      : null;
  } catch {
    return null;
  }
}

/** Embed a batch with the best reachable provider. Returns null when no
 * embedder is configured/reachable — callers fall back to keyword search. */
export async function embedTexts(
  texts: string[],
): Promise<{ provider: string; vecs: number[][] } | null> {
  if (texts.length === 0) return { provider: 'none', vecs: [] };
  const settings = await getSettings();
  if (settings.ollama.enabled) {
    const vecs = await ollamaEmbed(texts);
    if (vecs) return { provider: 'ollama', vecs };
  }
  const key = settings.gemini.apiKey.trim();
  if (settings.gemini.enabled && key) {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 90) {
      const part = await geminiEmbed(texts.slice(i, i + 90), key);
      if (!part) return null;
      out.push(...part);
    }
    return { provider: 'gemini', vecs: out };
  }
  return null;
}

// ---------- the vector index ----------

interface DocIndex {
  ts: number;
  provider: string;
  vecs: number[][];
}
type VecStore = Record<string, DocIndex>;

async function getVecStore(): Promise<VecStore> {
  const stored = await chrome.storage.local.get(VECS_KEY);
  return (stored[VECS_KEY] ?? {}) as VecStore;
}

/** Make sure every doc has up-to-date passage vectors (embed once, cache),
 * and drop vectors for docs that no longer exist. Best-effort: a doc that
 * can't be embedded right now simply stays keyword-searchable. */
export async function ensureIndexed(docs: NomiDoc[]): Promise<VecStore> {
  const store = await getVecStore();
  let dirty = false;
  for (const doc of docs) {
    const parts = splitPassages(doc.text);
    const have = store[doc.id];
    if (have && have.ts >= doc.ts && have.vecs.length === parts.length) continue;
    const embedded = await embedTexts(parts);
    if (!embedded) continue;
    store[doc.id] = { ts: doc.ts, provider: embedded.provider, vecs: embedded.vecs.map(quantize) };
    dirty = true;
  }
  for (const id of Object.keys(store)) {
    if (!docs.some((d) => d.id === id)) {
      delete store[id];
      dirty = true;
    }
  }
  if (dirty) await chrome.storage.local.set({ [VECS_KEY]: store });
  return store;
}

// ---------- semantic memory: rollups + journal as searchable passages ----------

/** Render the day-memory into small self-describing passages, one per rollup
 * day and one per journal entry, each with a stable key so vectors are only
 * computed once. Pure — tested in rag.test.ts. */
export function memoryPassages(
  rollups: { date: string; totalMs: number; topDomains: { domain: string; totalMs: number }[]; byCategory: Partial<Record<string, number>>; accepted: { slug: string }[] }[],
  journal: { id: string; ts: number; text: string }[],
): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const r of rollups) {
    if (r.totalMs < 5 * 60000) continue;
    const top = r.topDomains.slice(0, 4).map((d) => `${d.domain} ${Math.round(d.totalMs / 60000)}m`).join(', ');
    const cats = Object.entries(r.byCategory)
      .filter(([, ms]) => (ms ?? 0) >= 10 * 60000)
      .map(([c, ms]) => `${c} ${Math.round((ms ?? 0) / 60000)}m`)
      .join(', ');
    const solved = r.accepted.map((a) => a.slug.replace(/-/g, ' ')).join(', ');
    out.push({
      key: `r:${r.date}`,
      text:
        `On ${r.date} you were online ${Math.round(r.totalMs / 60000)} minutes.` +
        (top ? ` Sites: ${top}.` : '') +
        (cats ? ` Doing: ${cats}.` : '') +
        (solved ? ` Solved: ${solved}.` : ''),
    });
  }
  for (const j of journal) {
    const d = new Date(j.ts);
    const p = (n: number) => String(n).padStart(2, '0');
    out.push({ key: `j:${j.id}`, text: `On ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} you told me: ${j.text}` });
  }
  return out;
}

const MEM_VECS_KEY = 'nomi:vecs:mem';

interface MemIndex {
  provider: string;
  entries: Record<string, number[]>;
}

/** Semantic search over the day-memory (rollups + journal). Embeds only NEW
 * passages (stable keys), caches vectors, hybrid-ranks like the docs path.
 * Returns the best passage texts; empty when nothing relates. Never throws. */
export async function ragSearchMemory(
  query: string,
  passages: { key: string; text: string }[],
  limit = 3,
): Promise<string[]> {
  if (passages.length === 0) return [];
  try {
    const stored = await chrome.storage.local.get(MEM_VECS_KEY);
    const index = (stored[MEM_VECS_KEY] ?? { provider: '', entries: {} }) as MemIndex;
    const missing = passages.filter((p) => !index.entries[p.key]);
    let dirty = false;
    if (missing.length) {
      const embedded = await embedTexts(missing.map((p) => p.text));
      if (embedded) {
        if (index.provider && index.provider !== embedded.provider) {
          index.entries = {}; // provider changed — old vectors are another space
        }
        index.provider = embedded.provider;
        missing.forEach((p, i) => (index.entries[p.key] = quantize(embedded.vecs[i])));
        dirty = true;
      }
    }
    // prune keys whose passages are gone (old journal entries, pruned days)
    const live = new Set(passages.map((p) => p.key));
    for (const k of Object.keys(index.entries)) {
      if (!live.has(k)) {
        delete index.entries[k];
        dirty = true;
      }
    }
    if (dirty) await chrome.storage.local.set({ [MEM_VECS_KEY]: index });

    const q = await embedTexts([query]);
    const queryVec = q && q.provider === index.provider ? q.vecs[0] : null;
    const words = keywords(query);
    const kwScores = passages.map((p) => scorePassage(words, p.text));
    const passVecs = passages.map((p) => index.entries[p.key] ?? null);
    return rankHybrid(queryVec ?? null, passVecs, kwScores, limit).map((r) => passages[r.idx].text);
  } catch {
    // keyword-only fallback
    const words = keywords(query);
    return passages
      .map((p) => ({ p, s: scorePassage(words, p.text) }))
      .filter((x) => x.s >= 1)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.p.text);
  }
}

/** Semantic + keyword retrieval over the user's docs. Drop-in upgrade for
 * searchDocs(): same DocHit shape, better recall. Never throws. */
export async function ragSearchDocs(query: string, docs: NomiDoc[], limit = 5): Promise<DocHit[]> {
  if (docs.length === 0) return [];
  try {
    const store = await ensureIndexed(docs);
    const q = await embedTexts([query]);
    const queryVec = q?.vecs[0] ?? null;
    const words = keywords(query);
    const hits: DocHit[] = [];
    for (const doc of docs) {
      const parts = splitPassages(doc.text);
      const idx = store[doc.id];
      // Vectors only compare within the same embedding space.
      const usable = queryVec && idx && idx.provider === q!.provider && idx.vecs.length === parts.length;
      const passVecs = usable ? idx.vecs : parts.map(() => null as number[] | null);
      const kwScores = parts.map((p) => scorePassage(words, p));
      for (const r of rankHybrid(usable ? queryVec : null, passVecs, kwScores, limit)) {
        hits.push({ docName: doc.name, passage: parts[r.idx].slice(0, 900), score: r.score });
      }
    }
    if (hits.length === 0) return searchDocs(query, docs, limit);
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch {
    return searchDocs(query, docs, limit);
  }
}
