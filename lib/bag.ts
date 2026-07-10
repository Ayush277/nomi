/** Personal Bag (Core Vision #17) — the "smart storage". Phase one is links:
 * "remember this link" saves the current page with title, source, date, and
 * lets you get it back by asking. Files/drag-drop + cloud sync come with the
 * Nomi website (that's a separate, backend workstream). Stored locally. */

export interface SavedLink {
  id: string;
  url: string;
  title: string;
  domain: string;
  ts: number;
}

const BAG_KEY = 'nomi:bag';

export async function getLinks(): Promise<SavedLink[]> {
  const stored = await chrome.storage.local.get(BAG_KEY);
  return (stored[BAG_KEY] ?? []) as SavedLink[];
}

export async function saveLink(link: Omit<SavedLink, 'id' | 'ts'>): Promise<SavedLink> {
  const links = await getLinks();
  const entry: SavedLink = { ...link, id: crypto.randomUUID(), ts: Date.now() };
  // De-dupe by URL; newest wins and floats to the end.
  const next = [...links.filter((l) => l.url !== link.url), entry].slice(-200);
  await chrome.storage.local.set({ [BAG_KEY]: next });
  return entry;
}

export async function removeLink(id: string): Promise<void> {
  const links = await getLinks();
  await chrome.storage.local.set({ [BAG_KEY]: links.filter((l) => l.id !== id) });
}

export function isSaveLink(text: string): boolean {
  return /\b(remember|save|bag|keep|bookmark)\s+(this\s+)?(link|page|url|site|tab|article)\b/i.test(
    text,
  );
}

export function isRecallLinks(text: string): boolean {
  return /\b(links?|pages?|bookmarks?|saved)\b/i.test(text) &&
    /\b(what|which|show|give|list|my|find|get|saved?|remember)\b/i.test(text);
}

/** Natural retrieval: keyword over title + domain, newest first. */
export function searchLinks(query: string, links: SavedLink[]): SavedLink[] {
  const words = query
    .toLowerCase()
    .replace(/\b(what|which|show|give|me|the|link|links|page|pages|saved|save|about|for|find|get|my|did|i|you|last|week|remember)\b/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const sorted = [...links].sort((a, b) => b.ts - a.ts);
  if (words.length === 0) return sorted.slice(0, 5);
  return sorted.filter((l) => {
    const hay = `${l.title} ${l.domain}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}
