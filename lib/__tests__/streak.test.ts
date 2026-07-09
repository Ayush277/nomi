import { describe, expect, it } from 'vitest';
import { computeStreak, isActiveDay } from '../streak';
import type { DayRollup } from '../types';

const day = (date: string, codingMin: number, accepted = 0): DayRollup => ({
  date,
  totalMs: codingMin * 60000,
  byCategory: { coding: codingMin * 60000 },
  topDomains: [],
  firstTs: null,
  lastTs: null,
  tabSwitches: 0,
  accepted: Array.from({ length: accepted }, (_, i) => ({ slug: `p${i}`, difficulty: 'Easy' })),
});

describe('isActiveDay', () => {
  it('counts 30+ min of focus work or any accepted problem', () => {
    expect(isActiveDay(day('2026-07-10', 45))).toBe(true);
    expect(isActiveDay(day('2026-07-10', 5, 1))).toBe(true);
    expect(isActiveDay(day('2026-07-10', 10))).toBe(false);
  });
});

describe('computeStreak', () => {
  it('counts consecutive active days ending today', () => {
    const rollups = [day('2026-07-07', 60), day('2026-07-08', 90), day('2026-07-09', 40)];
    expect(computeStreak(rollups, day('2026-07-10', 60))).toBe(4);
  });

  it('a gap breaks the chain', () => {
    const rollups = [day('2026-07-06', 60), day('2026-07-08', 90), day('2026-07-09', 40)];
    expect(computeStreak(rollups, day('2026-07-10', 60))).toBe(3);
  });

  it("today not yet active doesn't break yesterday's streak", () => {
    const rollups = [day('2026-07-08', 90), day('2026-07-09', 40)];
    expect(computeStreak(rollups, day('2026-07-10', 0))).toBe(2);
  });

  it('inactive days in the record are skipped over correctly', () => {
    const rollups = [day('2026-07-08', 90), day('2026-07-09', 5)]; // 9th was idle
    expect(computeStreak(rollups, day('2026-07-10', 60))).toBe(1);
  });

  it('no history means streak of whatever today is', () => {
    expect(computeStreak([], day('2026-07-10', 60))).toBe(1);
    expect(computeStreak([], day('2026-07-10', 0))).toBe(0);
  });
});
