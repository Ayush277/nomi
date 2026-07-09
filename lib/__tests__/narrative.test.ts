import { describe, expect, it } from 'vitest';
import { narrate } from '../narrative';
import { buildRollup } from '../rollup';
import type { DayRollup, VisitSession } from '../types';

const at = (h: number, m = 0) => new Date(2026, 6, 9, h, m).getTime();

const session = (domain: string, category: VisitSession['category'], fromH: number, hours: number): VisitSession => ({
  id: crypto.randomUUID(),
  domain,
  category,
  startTs: at(fromH),
  endTs: at(fromH) + hours * 3600000,
  durationMs: hours * 3600000,
});

const codingDay: DayRollup = buildRollup(
  '2026-07-09',
  [session('leetcode.com', 'coding', 9, 4), session('youtube.com', 'entertainment', 14, 1)],
  [
    {
      id: '1',
      ts: at(11),
      type: 'site_signal',
      domain: 'leetcode.com',
      category: 'coding',
      signal: {
        adapter: 'leetcode',
        kind: 'submission_accepted',
        data: { slug: 'lru-cache', difficulty: 'Hard' },
      },
    },
  ],
);

describe('narrate', () => {
  it('tells a story, not a report: span, feeling, and the win', () => {
    const story = narrate(codingDay);
    expect(story).toMatch(/9:00\sAM/i);
    expect(story).toMatch(/Hard/);
    expect(story.split('. ').length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic for a given day', () => {
    expect(narrate(codingDay)).toBe(narrate(codingDay));
  });

  it('handles a nearly-empty day gently', () => {
    const story = narrate(buildRollup('2026-07-08', [], []));
    expect(story.length).toBeGreaterThan(10);
    expect(story).not.toMatch(/\d+m/); // no numbers thrown at a quiet day
  });

  it('never grades and never uses surveillance language', () => {
    const banned = /\b(monitor|surveil|detected|logged|tracking|tracked|productivity score|\d+%)\b/i;
    for (const r of [codingDay, buildRollup('2026-07-07', [session('reddit.com', 'social', 20, 2)], [])]) {
      expect(narrate(r)).not.toMatch(banned);
    }
  });
});
