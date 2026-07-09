import { formatClock, formatDuration, startOfDay, weekdayName } from './time';
import type { DayRollup, SiteCategory, VisitSession } from './types';

/** Memory search without an LLM (ADR-4): keyword + date matching over the
 * 7-day raw window plus rollups. Pure — data is passed in. */

const CATEGORY_KEYWORDS: Record<string, SiteCategory> = {
  coding: 'coding',
  code: 'coding',
  leetcode: 'coding',
  learning: 'learning',
  study: 'learning',
  studying: 'learning',
  videos: 'entertainment',
  video: 'entertainment',
  youtube: 'entertainment',
  music: 'music',
  shopping: 'shopping',
  jobs: 'career',
  internship: 'career',
};

const STOP_WORDS = new Set(
  'when did i last was were the a an on at in to for of my me you work working open opened use used visit visited spend spent time look looking'.split(
    ' ',
  ),
);

export function isMemoryQuery(text: string): boolean {
  return /when (did|was|were)|last time|have i (been|seen|visited|worked)/i.test(text);
}

function keywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function sessionMatches(s: VisitSession, words: string[]): boolean {
  const haystack = `${s.domain} ${s.path ?? ''}`.toLowerCase();
  return words.some(
    (w) => haystack.includes(w) || (CATEGORY_KEYWORDS[w] && CATEGORY_KEYWORDS[w] === s.category),
  );
}

function whenPhrase(ts: number, now: number): string {
  const today = startOfDay(now);
  if (ts >= today) return `earlier today around ${formatClock(ts)}`;
  if (ts >= today - 86400000) return `yesterday around ${formatClock(ts)}`;
  return `last ${weekdayName(ts)} around ${formatClock(ts)}`;
}

export function searchMemory(
  query: string,
  data: { sessions: VisitSession[]; rollups: DayRollup[]; now: number },
): string {
  const words = keywords(query);
  if (words.length === 0) {
    return "Tell me what to look for — a site or a topic, like 'when did I last open leetcode?'";
  }

  // Freshest first: raw sessions cover the last 7 days in full detail.
  const hit = [...data.sessions].sort((a, b) => b.startTs - a.startTs).find((s) =>
    sessionMatches(s, words),
  );
  if (hit) {
    return `That was ${whenPhrase(hit.startTs, data.now)} — about ${formatDuration(hit.durationMs)} on ${hit.domain}.`;
  }

  // Older than the raw window: rollups remember solved problems and top sites.
  for (const r of [...data.rollups].sort((a, b) => b.date.localeCompare(a.date))) {
    const slugHit = r.accepted.find((a) => words.some((w) => a.slug.includes(w)));
    if (slugHit) {
      return `You got "${slugHit.slug.replace(/-/g, ' ')}" accepted on ${r.date}.`;
    }
    const domainHit = r.topDomains.find((d) => words.some((w) => d.domain.includes(w)));
    if (domainHit) {
      return `Last I remember, ${r.date} — about ${formatDuration(domainHit.totalMs)} on ${domainHit.domain} that day.`;
    }
  }

  return "I don't remember seeing that in the last week — my detailed memory only goes back 7 days right now.";
}
