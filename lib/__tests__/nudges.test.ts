import { describe, expect, it } from 'vitest';
import { EMPTY_NUDGE_STATE, runNudgeEngine, type NudgeContext } from '../nudges/engine';
import { NUDGE_TEMPLATES, pickVariant } from '../nudges/messages';
import { DEFAULT_SETTINGS, type NomiEvent } from '../types';

/** 2 PM local on a fixed date — clear of default quiet hours (22–8). */
const NOW = new Date(2026, 6, 10, 14, 0, 0).getTime();
const LATE = new Date(2026, 6, 10, 23, 30, 0).getTime();

const ctx = (over: Partial<NudgeContext>): NudgeContext => ({
  now: NOW,
  currentVisit: null,
  recentEvents: [],
  todaySessions: [],
  settings: { ...DEFAULT_SETTINGS, quietHours: { startHour: 22, endHour: 8 } },
  state: structuredClone(EMPTY_NUDGE_STATE),
  ...over,
});

const winEvent = (ts: number, difficulty = 'Medium'): NomiEvent => ({
  id: crypto.randomUUID(),
  ts,
  type: 'site_signal',
  domain: 'leetcode.com',
  category: 'coding',
  signal: { adapter: 'leetcode', kind: 'submission_accepted', data: { slug: 'x', difficulty } },
});

const codingVisit = (minutesAgo: number) => ({
  tabId: 1,
  domain: 'leetcode.com',
  path: '/problems/x',
  category: 'coding' as const,
  startTs: NOW - minutesAgo * 60000,
});

describe('nudge rules', () => {
  it('celebrates a fresh accepted submission, Hard gets its own voice', () => {
    const n = runNudgeEngine(ctx({ recentEvents: [winEvent(NOW - 60000, 'Hard')] }));
    expect(n?.ruleId).toBe('leetcode-win');
    expect(NUDGE_TEMPLATES['leetcode-win-hard']).toContain(
      NUDGE_TEMPLATES['leetcode-win-hard'].find((t) => t === n?.text) ?? n?.text,
    );
  });

  it('acknowledges an hour of focus on a coding site', () => {
    const n = runNudgeEngine(ctx({ currentVisit: codingVisit(65) }));
    expect(n?.ruleId).toBe('focus-streak');
    expect(n?.text).toContain('leetcode.com');
  });

  it('greets once per day, then never again that day', () => {
    const first = runNudgeEngine(
      ctx({ todaySessions: [{ id: 's', domain: 'a.com', category: 'other', startTs: NOW - 60000, endTs: NOW, durationMs: 60000 }] }),
    );
    expect(first?.ruleId).toBe('greeting');
    const again = runNudgeEngine(
      ctx({
        todaySessions: [{ id: 's', domain: 'a.com', category: 'other', startTs: NOW - 60000, endTs: NOW, durationMs: 60000 }],
        state: first!.state,
      }),
    );
    expect(again).toBeNull(); // greeted + min-gap both block
  });
});

describe('guardrails (silence is a feature)', () => {
  it('daily cap stops everything', () => {
    const state = { ...structuredClone(EMPTY_NUDGE_STATE), countByDay: { '2026-07-10': 6 } };
    expect(runNudgeEngine(ctx({ currentVisit: codingVisit(65), state }))).toBeNull();
  });

  it('quiet hours mute ambient nudges…', () => {
    expect(
      runNudgeEngine(ctx({ now: LATE, currentVisit: { ...codingVisit(65), startTs: LATE - 65 * 60000 } })),
    ).toBeNull();
  });

  it('…but a win still gets celebrated', () => {
    const n = runNudgeEngine(ctx({ now: LATE, recentEvents: [winEvent(LATE - 30000)] }));
    expect(n?.ruleId).toBe('leetcode-win');
  });

  it('min gap: nothing ambient within 20 minutes of the last nudge', () => {
    const state = { ...structuredClone(EMPTY_NUDGE_STATE), lastAnyAt: NOW - 10 * 60000 };
    expect(runNudgeEngine(ctx({ currentVisit: codingVisit(65), state }))).toBeNull();
  });

  it('rule cooldown: the same rule stays quiet even after the gap', () => {
    const state = {
      ...structuredClone(EMPTY_NUDGE_STATE),
      lastAnyAt: NOW - 30 * 60000,
      lastFiredAt: { 'focus-streak': NOW - 60 * 60000 }, // < 2h cooldown
      greetedOn: '2026-07-10',
    };
    expect(runNudgeEngine(ctx({ currentVisit: codingVisit(65), state }))).toBeNull();
  });

  it('deep focus suppresses interruptions (tab-storm, hydration)', () => {
    const storm: NomiEvent[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      ts: NOW - i * 1000,
      type: 'tab_switch',
      domain: '',
      category: 'other',
    }));
    const n = runNudgeEngine(
      ctx({
        currentVisit: codingVisit(30), // in focus, but below the 60m streak bar
        recentEvents: storm,
        state: { ...structuredClone(EMPTY_NUDGE_STATE), greetedOn: '2026-07-10' },
      }),
    );
    expect(n).toBeNull();
  });
});

describe('voice', () => {
  it('rotates variants so Nomi never repeats itself back-to-back', () => {
    const a = pickVariant('hydration', {});
    const b = pickVariant('hydration', { hydration: a.variant });
    expect(b.variant).not.toBe(a.variant);
  });

  it('no template ever uses surveillance language', () => {
    const banned = /\b(monitor|monitoring|surveil|detected|logged|tracking|tracked|watching you)\b/i;
    for (const variants of Object.values(NUDGE_TEMPLATES)) {
      for (const t of variants) expect(t).not.toMatch(banned);
    }
  });
});
