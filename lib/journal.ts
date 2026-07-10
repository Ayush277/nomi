/** A simple activity journal so Nomi can actually answer "how many jobs did
 * I apply to?" — you tell it what you did, it logs it with a date, and counts
 * on demand. Stored locally like everything else. */

export interface JournalEntry {
  id: string;
  text: string;
  ts: number;
}

const JOURNAL_KEY = 'nomi:journal';

export async function getJournal(): Promise<JournalEntry[]> {
  const stored = await chrome.storage.local.get(JOURNAL_KEY);
  return (stored[JOURNAL_KEY] ?? []) as JournalEntry[];
}

export async function logEntry(text: string): Promise<JournalEntry> {
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    text: text.trim().replace(/\s+/g, ' ').slice(0, 200),
    ts: Date.now(),
  };
  const all = await getJournal();
  await chrome.storage.local.set({ [JOURNAL_KEY]: [...all, entry].slice(-500) });
  return entry;
}

/** "I applied to a job", "log that I finished the essay", "note: went to gym".
 * Returns the thing to log, or null. */
export function parseLog(text: string): string | null {
  const t = text.trim();
  // Explicit: "log/note/journal (that) ..."
  const explicit = t.match(/^(?:nomi[,\s]+)?(?:log|note|journal|track)(?:\s+that)?\s*[:,]?\s*(.+)/i);
  if (explicit) return explicit[1].trim();
  // Natural first-person past action: "I applied to a job", "I finished X".
  const action =
    /^(?:nomi[,\s]+)?i\s+(?:just\s+|also\s+|finally\s+)?(applied|submitted|finished|completed|did|solved|read|watched|attended|went|had|started|shipped|sent|wrote|built|studied|practiced|interviewed)\b/i;
  if (action.test(t)) return t.replace(/^(?:nomi[,\s]+)?/i, '').trim();
  return null;
}

/** "how many jobs did I apply to?", "how many workouts this week?" */
export function isCountQuery(text: string): boolean {
  return /\bhow many\b|\bhow much\b|\bcount\b/i.test(text);
}

const STOP = new Set(
  'how many much did do i have has the a an to of in on this week today month year jobs job times time ago there are was were you nomi about my me for and or so'.split(
    ' ',
  ),
);

/** Count journal entries matching the query's keywords (+ an optional
 * this-week/today window). */
export function countEntries(
  query: string,
  entries: JournalEntry[],
  now = Date.now(),
): { count: number; matched: JournalEntry[]; window: string } {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !STOP.has(w.replace(/s$/, '')))
    // Stem to a prefix so "apply" matches "applied", "applying", "application".
    .map((w) => (w.length >= 5 ? w.slice(0, 4) : w.replace(/s$/, '')));

  let since = 0;
  let window = 'ever';
  if (/\btoday\b/i.test(query)) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    since = d.getTime();
    window = 'today';
  } else if (/\bthis week\b|\bthis month\b|\brecently\b/i.test(query)) {
    since = now - 7 * 86400000;
    window = 'this week';
  }

  const matched = entries.filter((e) => {
    if (e.ts < since) return false;
    if (words.length === 0) return true;
    const hay = e.text.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
  return { count: matched.length, matched, window };
}
