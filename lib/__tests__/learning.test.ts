import { describe, expect, it } from 'vitest';
import { computeLearnedProfile, describeLearned, LEARN_MIN_DAYS } from '../learning';
import type { DayRollup, VisitSession } from '../types';

const DAY = 86400000;
// Anchor to 10am so start-hours are deterministic regardless of the test host.
const base = new Date(2026, 0, 1, 10, 0, 0).getTime();

function session(domain: string, category: VisitSession['category'], dayOffset: number, path = '/'): VisitSession {
  const startTs = base - dayOffset * DAY;
  return { id: `${domain}-${dayOffset}`, domain, path, category, startTs, endTs: startTs + 30 * 60000, durationMs: 30 * 60000 };
}

describe('computeLearnedProfile — requires repeated evidence', () => {
  it('learns nothing from fewer than LEARN_MIN_DAYS of data', () => {
    const sessions = [session('leetcode.com', 'coding', 0), session('leetcode.com', 'coding', 1)];
    const l = computeLearnedProfile(sessions, [], [], base);
    expect(l.daysObserved).toBe(2);
    expect(l.peakHours).toEqual([]);
    expect(l.favoriteTech).toBeNull();
    expect(describeLearned(l)).toBeNull();
    expect(l.daysObserved).toBeLessThan(LEARN_MIN_DAYS);
  });

  it('learns recurring hour, tech, project and distraction across days', () => {
    // Same pattern on 3 distinct days → recurs.
    const sessions = [0, 1, 2].flatMap((d) => [
      session('docs.python.org', 'learning', d),
      session('github.com', 'coding', d, '/ayush/nomi'),
      session('twitter.com', 'social', d),
    ]);
    const l = computeLearnedProfile(sessions, [], [], base);

    expect(l.daysObserved).toBe(3);
    expect(l.peakHours).toContain(10);
    expect(l.favoriteTech).toBe('Python');
    expect(l.mostActiveProject).toBe('nomi'); // github repo auto-project
    expect(l.typicalDistractions).toContain('twitter.com');

    const line = describeLearned(l)!;
    expect(line).toContain('Python');
    expect(line).toContain('nomi');
  });

  it('does not assert a trait seen on only one day', () => {
    const sessions = [
      session('docs.python.org', 'learning', 0), // Python once
      session('go.dev', 'learning', 0),
      session('go.dev', 'learning', 1),
      session('go.dev', 'learning', 2), // Go recurs 3 days
    ];
    const l = computeLearnedProfile(sessions, [], [], base);
    expect(l.favoriteTech).toBe('Go'); // recurring one wins; Python (1 day) excluded
  });
});

describe('frequentSites from rollups', () => {
  it('surfaces domains that recur across rollup days', () => {
    const roll = (date: string, domain: string): DayRollup => ({
      date,
      totalMs: 3600000,
      byCategory: { coding: 3600000 },
      topDomains: [{ domain, category: 'coding', totalMs: 3600000 }],
      firstTs: 0,
      lastTs: 0,
      tabSwitches: 0,
      accepted: [],
    });
    const sessions = [0, 1, 2].map((d) => session('leetcode.com', 'coding', d));
    const rollups = [roll('2026-01-01', 'leetcode.com'), roll('2026-01-02', 'leetcode.com')];
    const l = computeLearnedProfile(sessions, rollups, [], base);
    expect(l.frequentSites).toContain('leetcode.com');
  });
});
