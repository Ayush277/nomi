import { describe, expect, it } from 'vitest';
import { assessWellbeing, deriveWellbeingInput, type WellbeingInput } from '../wellbeing';
import type { NomiEvent, VisitSession } from '../types';

const H = 3600000;
const base = (over: Partial<WellbeingInput> = {}): WellbeingInput => ({
  now: 0,
  hour: 14,
  activeMsToday: 1 * H,
  sinceBreakMs: 20 * 60000,
  tabSwitchesRecent: 2,
  ...over,
});

describe('assessWellbeing — only speaks when strain stacks', () => {
  it('stays quiet on a normal, paced session', () => {
    expect(assessWellbeing(base())).toBeNull();
  });

  it('one signal alone is not enough', () => {
    // A long day but breaks taken, daytime, calm → not strained.
    expect(assessWellbeing(base({ activeMsToday: 5.5 * H, sinceBreakMs: 10 * 60000 }))?.strain).not.toBe(
      'strained',
    );
  });

  it('flags a late-night marathon with the evidence', () => {
    const a = assessWellbeing(base({ hour: 23, sinceBreakMs: 2.5 * H }))!;
    expect(a.strain).toBe('strained');
    expect(a.templateKey).toBe('wellbeing-latenight');
    expect(a.slots.clock).toBeTruthy();
    expect(a.slots.reason).toMatch(/hour|break/i);
  });

  it('flags a long unbroken stretch during the day as a break check-in', () => {
    const a = assessWellbeing(base({ sinceBreakMs: 2 * H, tabSwitchesRecent: 14 }))!;
    expect(a.strain).toBe('strained');
    expect(a.templateKey).toBe('wellbeing-break');
  });

  it('flags a genuinely full day on its own (7h, even with breaks)', () => {
    const a = assessWellbeing(base({ activeMsToday: 7 * H, sinceBreakMs: 20 * 60000 }))!;
    expect(a.strain).toBe('strained');
    expect(a.templateKey).toBe('wellbeing-longday');
  });

  it('two signals without an amplifier = pushing, but silent', () => {
    const a = assessWellbeing(base({ activeMsToday: 5.5 * H, tabSwitchesRecent: 14 }));
    expect(a?.strain).toBe('pushing'); // not 'strained' → the rule won't fire
  });
});

describe('deriveWellbeingInput', () => {
  const session = (startTs: number, durationMs: number): VisitSession => ({
    id: String(startTs),
    domain: 'x.com',
    category: 'coding',
    startTs,
    endTs: startTs + durationMs,
    durationMs,
  });
  const ev = (type: NomiEvent['type'], ts: number): NomiEvent => ({
    id: `${type}${ts}`,
    ts,
    type,
    domain: '',
    category: 'other',
  });

  it('counts continuous active time since the last break-end', () => {
    const now = 3 * H;
    const i = deriveWellbeingInput(
      now,
      [session(0, 2 * H)],
      [ev('idle_start', 0.5 * H), ev('idle_end', 1 * H)],
      null,
    );
    expect(Math.round(i.sinceBreakMs / H)).toBe(2); // active since idle_end at 1h
  });

  it('treats a current idle period as being on a break (no strain)', () => {
    const now = 3 * H;
    const i = deriveWellbeingInput(now, [session(0, 2 * H)], [ev('idle_start', 2.9 * H)], null);
    expect(i.sinceBreakMs).toBe(0);
  });
});
