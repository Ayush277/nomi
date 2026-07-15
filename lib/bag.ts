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
  /** Set once when Nomi gently resurfaces a forgotten save — never twice. */
  resurfacedTs?: number;
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

export async function markResurfaced(id: string): Promise<void> {
  const links = await getLinks();
  await chrome.storage.local.set({
    [BAG_KEY]: links.map((l) => (l.id === id ? { ...l, resurfacedTs: Date.now() } : l)),
  });
}

export async function removeLink(id: string): Promise<void> {
  const links = await getLinks();
  await chrome.storage.local.set({ [BAG_KEY]: links.filter((l) => l.id !== id) });
}

export async function clearBag(): Promise<void> {
  await chrome.storage.local.set({ [BAG_KEY]: [] });
}

/** "remove/delete/forget the link about X", "unsave that page", "clear my bag". */
export function isRemoveLink(text: string): boolean {
  return (
    /\b(remove|delete|forget|drop|unsave|clear|wipe)\b.*\b(link|links|page|pages|bookmark|saved|bag|it|that)\b/i.test(
      text,
    ) || /\b(clear|empty|wipe)\s+(my\s+)?bag\b/i.test(text)
  );
}

export function isSaveLink(text: string): boolean {
  // "remember this link", "save this page", "keep it in the bag",
  // "keep this in memory", "bookmark this", "add this to my bag".
  return (
    /\b(remember|save|bag|keep|bookmark|store|add)\b.*\b(link|page|url|site|tab|article|bag|memory)\b/i.test(
      text,
    ) || /\b(bookmark|save|bag)\s+(this|it)\b/i.test(text)
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
    .replace(/\b(what|which|show|give|me|the|link|links|page|pages|saved|save|about|for|find|get|my|did|i|you|last|week|remember|remove|delete|forget|drop|unsave|from|bag|are|is|was|were|have|has|had|all|list|tell|nomi|please)\b/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const sorted = [...links].sort((a, b) => b.ts - a.ts);
  if (words.length === 0) return sorted.slice(0, 5);
  return sorted.filter((l) => {
    const hay = `${l.title} ${l.domain}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}
