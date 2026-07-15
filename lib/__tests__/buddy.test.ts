import { describe, expect, it } from 'vitest';
import {
  describeOpenLoop,
  findOpenLoop,
  morningBrief,
  pickResurface,
  resurfaceText,
  weekKey,
  weeklyReview,
} from '../buddy';
import { memoryPassages } from '../rag';
import { EMPTY_AUTODOC, renderAutodoc, withWeekly } from '../autodoc';
import type { SavedLink } from '../bag';
import type { DayRollup, VisitSession } from '../types';

const DAY = 86400000;
const NOW = new Date('2026-07-14T09:30:00').getTime();

function session(over: Partial<VisitSession>): VisitSession {
  return {
    id: Math.random().toString(36).slice(2),
    domain: 'react.dev',
    category: 'learning',
    startTs: NOW - DAY,
    endTs: NOW - DAY + 20 * 60000,
    durationMs: 20 * 60000,
    ...over,
  };
}

function rollup(over: Partial<DayRollup>): DayRollup {
  return {
    date: '2026-07-13',
    totalMs: 2 * 3600000,
    byCategory: { coding: 60 * 60000, learning: 30 * 60000 },
    topDomains: [{ domain: 'github.com', totalMs: 50 * 60000, category: 'coding' }],
    firstTs: null,
    lastTs: null,
    tabSwitches: 10,
    accepted: [],
    ...over,
  };
}

describe('findOpenLoop', () => {
  it('picks the longest deep coding/learning session not revisited today', () => {
    const loop = findOpenLoop(
      [
        session({ domain: 'react.dev', durationMs: 45 * 60000, path: '/learn' }),
        session({ domain: 'go.dev', durationMs: 20 * 60000 }),
      ],
      new Set(),
      NOW,
    );
    expect(loop?.domain).toBe('react.dev');
    expect(loop?.url).toBe('https://react.dev/learn');
    expect(loop?.minutes).toBe(45);
    expect(describeOpenLoop(loop!)).toContain('45 minutes deep in react.dev yesterday');
  });

  it('skips domains already visited today, short sessions, and distractions', () => {
    expect(
      findOpenLoop([session({ domain: 'react.dev', durationMs: 45 * 60000 })], new Set(['react.dev']), NOW),
    ).toBeNull();
    expect(findOpenLoop([session({ durationMs: 5 * 60000 })], new Set(), NOW)).toBeNull();
    expect(
      findOpenLoop([session({ category: 'social', durationMs: 60 * 60000 })], new Set(), NOW),
    ).toBeNull();
  });

  it('ignores sessions from today — an open loop is something you LEFT', () => {
    expect(
      findOpenLoop([session({ startTs: NOW - 3600000, durationMs: 45 * 60000 })], new Set(), NOW),
    ).toBeNull();
  });
});

describe('morningBrief', () => {
  it('composes yesterday, reminders, and the open loop', () => {
    const text = morningBrief({
      yesterday: rollup({ totalMs: 3 * 3600000 + 20 * 60000 }),
      remindersToday: [{ what: 'call mom', at: new Date('2026-07-14T18:00:00').getTime() }],
      loop: { domain: 'react.dev', url: 'https://react.dev', minutes: 45, daysAgo: 1 },
      name: 'Ayush',
    });
    expect(text).toContain('Morning, Ayush.');
    expect(text).toContain('Yesterday: 3h 20m online, mostly github.com.');
    expect(text).toContain('"call mom" around 6pm');
    expect(text).toContain('what was I doing');
  });

  it('says nothing when there is nothing worth saying', () => {
    expect(morningBrief({ yesterday: null, remindersToday: [], loop: null })).toBeNull();
    expect(
      morningBrief({ yesterday: rollup({ totalMs: 4 * 60000 }), remindersToday: [], loop: null }),
    ).toBeNull();
  });
});

describe('weeklyReview', () => {
  const week = [
    rollup({ date: '2026-07-08', totalMs: 3 * 3600000, accepted: [{ slug: 'two-sum', difficulty: 'easy' }] }),
    rollup({ date: '2026-07-10', totalMs: 2 * 3600000 }),
  ];
  const prevWeek = [rollup({ date: '2026-07-02', byCategory: { coding: 30 * 60000 } })];

  it('reports totals, wins, journal, goal trend, and peak hours', () => {
    const text = weeklyReview({
      week,
      prevWeek,
      journal: [{ ts: NOW - DAY, text: 'applied to a job' }],
      goal: 'land an internship',
      learned: {
        peakHours: [22],
        frequentSites: [],
        favoriteTech: null,
        mostActiveProject: null,
        typicalDistractions: [],
        daysObserved: 7,
        computedTs: NOW,
      },
    })!;
    expect(text).toContain('This week: 5h online across 2 days');
    expect(text).toContain('1 problem solved');
    expect(text).toContain('"applied to a job"');
    expect(text).toContain('Toward "land an internship": 3h');
    expect(text).toContain('up 500% on last week');
    expect(text).toContain('around 10pm');
  });

  it('stays silent for an empty week', () => {
    expect(weeklyReview({ week: [], prevWeek: [], journal: [] })).toBeNull();
  });

  it('weekKey is stable within a week', () => {
    expect(weekKey(NOW)).toBe(weekKey(NOW + 2 * 3600000));
    expect(weekKey(NOW)).toMatch(/^2026-W\d{2}$/);
  });
});

describe('pickResurface', () => {
  const link = (over: Partial<SavedLink>): SavedLink => ({
    id: Math.random().toString(36).slice(2),
    url: 'https://x.dev',
    title: 'A thing',
    domain: 'x.dev',
    ts: NOW - 5 * DAY,
    ...over,
  });

  it('returns the OLDEST never-resurfaced link past 3 days', () => {
    const oldest = link({ ts: NOW - 10 * DAY, title: 'Oldest' });
    const got = pickResurface([link({ ts: NOW - 4 * DAY }), oldest], NOW);
    expect(got?.title).toBe('Oldest');
    expect(resurfaceText(got!, NOW)).toContain('10 days ago');
    expect(resurfaceText(got!, NOW)).toContain('"Oldest"');
  });

  it('never resurfaces twice, and never resurfaces fresh saves', () => {
    expect(pickResurface([link({ resurfacedTs: NOW - DAY })], NOW)).toBeNull();
    expect(pickResurface([link({ ts: NOW - DAY })], NOW)).toBeNull();
  });
});

describe('memoryPassages', () => {
  it('renders self-describing dated passages for rollups and journal', () => {
    const out = memoryPassages(
      [rollup({ date: '2026-07-10', accepted: [{ slug: 'two-sum', difficulty: 'easy' }] })],
      [{ id: 'j1', ts: new Date('2026-07-12T10:00:00').getTime(), text: 'applied to a job' }],
    );
    expect(out).toHaveLength(2);
    expect(out[0].key).toBe('r:2026-07-10');
    expect(out[0].text).toContain('On 2026-07-10 you were online 120 minutes');
    expect(out[0].text).toContain('github.com 50m');
    expect(out[0].text).toContain('Solved: two sum');
    expect(out[1].key).toBe('j:j1');
    expect(out[1].text).toBe('On 2026-07-12 you told me: applied to a job');
  });

  it('skips days too small to mean anything', () => {
    expect(memoryPassages([rollup({ totalMs: 2 * 60000 })], [])).toHaveLength(0);
  });
});

describe('autodoc weekly section', () => {
  it('renders reviews newest first and replaces the same week', () => {
    let s = withWeekly(EMPTY_AUTODOC, '2026-W28', 'first week');
    s = withWeekly(s, '2026-W29', 'second week');
    s = withWeekly(s, '2026-W29', 'second week, revised');
    const md = renderAutodoc(s);
    expect(md).toContain('## Weekly reviews');
    expect(md.indexOf('2026-W29')).toBeLessThan(md.indexOf('2026-W28'));
    expect(md).toContain('second week, revised');
    expect(md).not.toContain('second week\n');
  });
});
