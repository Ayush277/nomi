import { formatClock, formatDuration } from './time';
import type { DayRollup, SiteCategory } from './types';

/** Template-based daily story (ADR-4: no LLM required). Voice rules from
 * DESIGN.md: warm, brief, specific, first person, never clinical, never a
 * grade, never guilt. Variant choice is seeded by the date so the same day
 * always reads the same, but days differ. */

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick<T>(options: T[], seed: number, salt: number): T {
  return options[(seed + salt * 7) % options.length];
}

const CATEGORY_PHRASE: Record<SiteCategory, string> = {
  coding: 'code',
  learning: 'learning things',
  social: 'catching up with people',
  entertainment: 'watching things',
  shopping: 'browsing shops',
  career: 'career stuff',
  music: 'music',
  other: 'this and that',
};

function topCategory(r: DayRollup): { category: SiteCategory; ms: number } | null {
  let best: { category: SiteCategory; ms: number } | null = null;
  for (const [category, ms] of Object.entries(r.byCategory) as [SiteCategory, number][]) {
    if (!best || ms > best.ms) best = { category, ms };
  }
  return best;
}

export function narrate(r: DayRollup, seed = hashSeed(r.date)): string {
  if (r.totalMs < 10 * 60000) {
    return pick(
      [
        'A quiet day — we barely crossed paths. That can be a good thing.',
        "Barely saw you today. Hope it was a good one out there.",
        'Not much screen time today. Sometimes that is the whole point.',
      ],
      seed,
      1,
    );
  }

  const parts: string[] = [];
  const top = topCategory(r);
  const focusedTop = top && top.ms > r.totalMs * 0.55 ? top : null;

  // Opener — a feeling, not a score.
  if (
    r.accepted.length >= 2 ||
    (focusedTop && (focusedTop.category === 'coding' || focusedTop.category === 'learning'))
  ) {
    parts.push(pick(['Today felt productive.', 'Solid day.', 'Today had real momentum.'], seed, 2));
  } else if (focusedTop) {
    parts.push(`Today was mostly about ${CATEGORY_PHRASE[focusedTop.category]}.`);
  } else {
    parts.push(pick(['A bit of everything today.', 'Today wandered around a little.'], seed, 3));
  }

  // The span of the day.
  if (r.firstTs && r.lastTs) {
    parts.push(
      `We were at it from ${formatClock(r.firstTs)} to ${formatClock(r.lastTs)} — about ${formatDuration(r.totalMs)} together.`,
    );
  }

  // Wins get specifics; specifics are what make it feel real.
  if (r.accepted.length > 0) {
    const hard = r.accepted.filter((a) => a.difficulty === 'Hard').length;
    const problems = r.accepted.length === 1 ? 'problem' : 'problems';
    parts.push(
      hard > 0
        ? `You got ${r.accepted.length} LeetCode ${problems} accepted — including ${hard === 1 ? 'a Hard one' : `${hard} Hard ones`}. That's progress.`
        : `You got ${r.accepted.length} LeetCode ${problems} accepted. Nice.`,
    );
  } else if (top && r.topDomains[0]) {
    parts.push(
      `${r.topDomains[0].domain} took the biggest share (${formatDuration(r.topDomains[0].totalMs)}).`,
    );
  }

  return parts.join(' ');
}
