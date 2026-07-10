/** Nomi Space — the user's own knowledge base. They upload documents (resume,
 * notes, meeting docs); Nomi extracts the text, keeps it locally, and answers
 * from it FIRST — only falling back to general AI when nothing here fits.
 * Stored in chrome.storage.local (needs unlimitedStorage). */

export interface NomiDoc {
  id: string;
  name: string;
  kind: string; // 'pdf' | 'text' | 'note'
  text: string;
  chars: number;
  ts: number;
}

const DOCS_KEY = 'nomi:docs';
const MAX_DOC_CHARS = 60000;

export async function getDocs(): Promise<NomiDoc[]> {
  const stored = await chrome.storage.local.get(DOCS_KEY);
  return (stored[DOCS_KEY] ?? []) as NomiDoc[];
}

export async function addDoc(name: string, kind: string, text: string): Promise<NomiDoc> {
  const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_DOC_CHARS);
  const doc: NomiDoc = {
    id: crypto.randomUUID(),
    name: name.slice(0, 120),
    kind,
    text: clean,
    chars: clean.length,
    ts: Date.now(),
  };
  const all = await getDocs();
  await chrome.storage.local.set({ [DOCS_KEY]: [...all, doc] });
  return doc;
}

export async function removeDoc(id: string): Promise<void> {
  const all = await getDocs();
  await chrome.storage.local.set({ [DOCS_KEY]: all.filter((d) => d.id !== id) });
}

const STOP = new Set(
  'the a an of to in on for and or is are was were what when who how do does did i you my me about tell give show is it this that with from can could'.split(
    ' ',
  ),
);

function keywords(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  ];
}

/** Split a doc into ~700-char passages on paragraph/sentence boundaries. */
function passages(text: string): string[] {
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= 900) {
      if (p.trim()) out.push(p.trim());
    } else {
      const sents = p.match(/[^.!?]+[.!?]*/g) ?? [p];
      let buf = '';
      for (const s of sents) {
        if ((buf + s).length > 700) {
          if (buf.trim()) out.push(buf.trim());
          buf = s;
        } else buf += s;
      }
      if (buf.trim()) out.push(buf.trim());
    }
  }
  return out;
}

export interface DocHit {
  docName: string;
  passage: string;
  score: number;
}

/** Score every passage across all docs by keyword overlap; return the best
 * few so the chat can ground its answer in the user's own material. */
export function searchDocs(query: string, docs: NomiDoc[], limit = 3): DocHit[] {
  const words = keywords(query);
  if (words.length === 0 || docs.length === 0) return [];
  const hits: DocHit[] = [];
  for (const doc of docs) {
    for (const passage of passages(doc.text)) {
      const hay = passage.toLowerCase();
      let score = 0;
      for (const w of words) {
        const n = hay.split(w).length - 1;
        if (n > 0) score += 1 + Math.min(n - 1, 2) * 0.3;
      }
      if (score > 0) hits.push({ docName: doc.name, passage: passage.slice(0, 900), score });
    }
  }
  // Require at least a token of real overlap so we don't ground on noise.
  return hits
    .filter((h) => h.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
