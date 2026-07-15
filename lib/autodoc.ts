/** The Living Document — Nomi's basic rule made real: analyze everything,
 * keep a base for it. Nomi auto-writes ONE structured markdown document about
 * the user — profile, learned working patterns, how they're changing, what
 * they told it, and a dated daily log — and keeps it in Nomi Space like any
 * uploaded doc. That means: the user can open and read exactly what Nomi
 * keeps, and chat/RAG ground answers in it automatically.
 *
 * Pure reducers + renderer here (unit-tested, no chrome.*); thin async
 * wrappers at the bottom persist state and upsert the doc. */

import { upsertDoc } from './docs';

export const AUTODOC_ID = 'nomi-autodoc';
export const AUTODOC_NAME = "About you — Nomi's notes";

export interface AutodocState {
  /** Things the user explicitly told Nomi (journal entries, remembered facts). */
  told: { ts: number; text: string }[];
  /** One digest per day, newest kept last. */
  days: { date: string; digest: string }[];
  /** Dated observations about how the user's patterns are shifting. */
  changes: { ts: number; text: string }[];
  /** One review per week (key "2026-W29"), written Sunday evenings. */
  weekly: { week: string; text: string }[];
  /** One-line profile summary (name / goal / facts), refreshed by the caller. */
  profileLine: string | null;
  /** One-line learned-patterns summary from lib/learning, ditto. */
  learnedLine: string | null;
}

export const EMPTY_AUTODOC: AutodocState = {
  told: [],
  days: [],
  changes: [],
  weekly: [],
  profileLine: null,
  learnedLine: null,
};

const AUTODOC_KEY = 'nomi:autodoc';
const MAX_TOLD = 200;
const MAX_DAYS = 60;
const MAX_CHANGES = 30;

// ---------- pure reducers ----------

export function withTold(s: AutodocState, text: string, ts = Date.now()): AutodocState {
  const clean = text.trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!clean) return s;
  return { ...s, told: [...s.told, { ts, text: clean }].slice(-MAX_TOLD) };
}

/** Same-date digests replace (a day can be re-rolled); order stays by date. */
export function withDay(s: AutodocState, date: string, digest: string): AutodocState {
  const clean = digest.trim().slice(0, 1200);
  if (!clean) return s;
  const days = [...s.days.filter((d) => d.date !== date), { date, digest: clean }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS);
  return { ...s, days };
}

/** Same-week reviews replace; capped like everything else. */
export function withWeekly(s: AutodocState, week: string, text: string): AutodocState {
  const clean = text.trim().slice(0, 1200);
  if (!clean) return s;
  const weekly = [...s.weekly.filter((w) => w.week !== week), { week, text: clean }]
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-26);
  return { ...s, weekly };
}

export function withChange(s: AutodocState, text: string, ts = Date.now()): AutodocState {
  const clean = text.trim().slice(0, 400);
  if (!clean) return s;
  // Don't re-record the same observation back to back.
  const last = s.changes[s.changes.length - 1];
  if (last && last.text === clean) return s;
  return { ...s, changes: [...s.changes, { ts, text: clean }].slice(-MAX_CHANGES) };
}

// ---------- pure renderer ----------

function isoDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Render the whole document with proper headings and subsections. Newest
 * material first inside each section — that's what the user asks about. */
export function renderAutodoc(s: AutodocState): string {
  const lines: string[] = [
    "# About you — kept by Nomi",
    '',
    'Nomi writes this document by itself: what you tell it, what your days look like, and how your patterns are changing. It stays on this device, and Nomi answers your questions from it.',
    '',
    '## Profile',
    '',
    s.profileLine ?? 'Nothing saved yet. Say "remember that …" and it lands here.',
    '',
    '## How you work',
    '',
    s.learnedLine ?? 'Still learning. Nomi needs a few days of evidence before it claims a pattern.',
    '',
    '## How you are changing',
    '',
  ];
  if (s.changes.length === 0) {
    lines.push('No shifts recorded yet. Once enough days accumulate, week-over-week changes show up here.');
  } else {
    for (const c of [...s.changes].reverse()) lines.push(`- ${isoDay(c.ts)}: ${c.text}`);
  }
  lines.push('', '## Weekly reviews', '');
  if (s.weekly.length === 0) {
    lines.push('Every Sunday evening a review of the week lands here: totals, wins, and movement toward your goal.');
  } else {
    for (const w of [...s.weekly].reverse()) lines.push(`### ${w.week}`, '', w.text, '');
  }
  lines.push('', '## Things you told me', '');
  if (s.told.length === 0) {
    lines.push('Nothing yet. Anything you log or ask Nomi to remember is recorded here with its date.');
  } else {
    for (const t of [...s.told].reverse()) lines.push(`- ${isoDay(t.ts)}: ${t.text}`);
  }
  lines.push('', '## Daily log', '');
  if (s.days.length === 0) {
    lines.push('The first full day Nomi observes will be summarised here.');
  } else {
    for (const d of [...s.days].reverse()) lines.push(`### ${d.date}`, '', d.digest, '');
  }
  return lines.join('\n').trim() + '\n';
}

/** One day, one paragraph: honest numbers from the rollup + what they logged.
 * Pure so tests can pin the wording. */
export function dayDigest(
  r: {
    totalMs: number;
    topDomains: { domain: string; totalMs: number }[];
    byCategory: Partial<Record<string, number>>;
    tabSwitches: number;
  },
  journal: string[] = [],
): string {
  const h = Math.floor(r.totalMs / 3600000);
  const m = Math.round((r.totalMs % 3600000) / 60000);
  const time = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const top = r.topDomains
    .slice(0, 3)
    .map((d) => `${d.domain} (${Math.max(1, Math.round(d.totalMs / 60000))}m)`)
    .join(', ');
  const cats = Object.entries(r.byCategory)
    .filter(([, ms]) => (ms ?? 0) >= 5 * 60000)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3)
    .map(([c, ms]) => `${c} ${Math.round((ms ?? 0) / 60000)}m`)
    .join(', ');
  const bits = [`Online ${time}.`];
  if (top) bits.push(`Mostly on ${top}.`);
  if (cats) bits.push(`By kind: ${cats}.`);
  if (r.tabSwitches > 0) bits.push(`${r.tabSwitches} tab switches.`);
  if (journal.length) bits.push(`You logged: ${journal.slice(0, 5).join('; ')}.`);
  return bits.join(' ');
}

// ---------- persistence (thin, chrome-backed) ----------

export async function getAutodoc(): Promise<AutodocState> {
  const stored = await chrome.storage.local.get(AUTODOC_KEY);
  return { ...EMPTY_AUTODOC, ...((stored[AUTODOC_KEY] ?? {}) as Partial<AutodocState>) };
}

async function saveAutodoc(s: AutodocState): Promise<void> {
  await chrome.storage.local.set({ [AUTODOC_KEY]: s });
  // Re-publish into Nomi Space so chat + RAG always search the fresh version.
  await upsertDoc(AUTODOC_ID, AUTODOC_NAME, 'auto', renderAutodoc(s));
}

export async function autodocTold(text: string): Promise<void> {
  try {
    await saveAutodoc(withTold(await getAutodoc(), text));
  } catch {
    /* best-effort — never block a chat reply on bookkeeping */
  }
}

export async function autodocDay(date: string, digest: string): Promise<void> {
  try {
    await saveAutodoc(withDay(await getAutodoc(), date, digest));
  } catch {
    /* best-effort */
  }
}

export async function autodocWeekly(week: string, text: string): Promise<void> {
  try {
    await saveAutodoc(withWeekly(await getAutodoc(), week, text));
  } catch {
    /* best-effort */
  }
}

export async function autodocChange(text: string): Promise<void> {
  try {
    await saveAutodoc(withChange(await getAutodoc(), text));
  } catch {
    /* best-effort */
  }
}

/** Refresh the Profile / How-you-work headers from current profile + learned
 * traits. Called after facts change and once a day from the background. */
export async function autodocMeta(profileLine: string | null, learnedLine: string | null): Promise<void> {
  try {
    const s = await getAutodoc();
    await saveAutodoc({ ...s, profileLine, learnedLine });
  } catch {
    /* best-effort */
  }
}
