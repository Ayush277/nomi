import { describe, expect, it } from 'vitest';
import { isMemoryQuery, searchMemory } from '../memory';
import type { DayRollup, VisitSession } from '../types';

const NOW = new Date(2026, 6, 10, 15, 0).getTime();
const daysAgo = (d: number, hour = 11) => {
  const dt = new Date(2026, 6, 10 - d, hour, 0);
  return dt.getTime();
};

const sessions: VisitSession[] = [
  {
    id: '1',
    domain: 'portfolio-site.dev',
    path: '/edit',
    category: 'coding',
    startTs: daysAgo(3),
    endTs: daysAgo(3) + 40 * 60000,
    durationMs: 40 * 60000,
  },
  {
    id: '2',
    domain: 'leetcode.com',
    path: '/problems/course-schedule',
    category: 'coding',
    startTs: daysAgo(0, 9),
    endTs: daysAgo(0, 9) + 3600000,
    durationMs: 3600000,
  },
];

const rollups: DayRollup[] = [
  {
    date: '2026-06-20',
    totalMs: 2 * 3600000,
    byCategory: { coding: 2 * 3600000 },
    topDomains: [{ domain: 'github.com', category: 'coding', totalMs: 2 * 3600000 }],
    firstTs: null,
    lastTs: null,
    tabSwitches: 4,
    accepted: [{ slug: 'binary-search', difficulty: 'Easy' }],
  },
];

describe('isMemoryQuery', () => {
  it('spots recall questions', () => {
    expect(isMemoryQuery('when did I last work on my portfolio?')).toBe(true);
    expect(isMemoryQuery('have I been on youtube today')).toBe(true);
    expect(isMemoryQuery('tell me a joke')).toBe(false);
  });
});

describe('searchMemory', () => {
  const data = { sessions, rollups, now: NOW };

  it('finds recent sessions by domain keyword', () => {
    const a = searchMemory('when did I last work on my portfolio?', data);
    expect(a).toContain('portfolio-site.dev');
    expect(a).toMatch(/40m/);
  });

  it('finds things by path keyword (problem slugs)', () => {
    const a = searchMemory('when was I on course-schedule?', data);
    expect(a).toContain('leetcode.com');
    expect(a).toMatch(/today/i);
  });

  it('falls back to rollup memory beyond the raw window', () => {
    const a = searchMemory('when did I last solve binary-search?', data);
    expect(a).toContain('2026-06-20');
  });

  it('admits honestly when it does not remember', () => {
    const a = searchMemory('when did I last visit narwhal-facts.org?', data);
    expect(a).toMatch(/don't remember/i);
  });
});
