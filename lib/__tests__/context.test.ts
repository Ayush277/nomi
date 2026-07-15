import { describe, expect, it } from 'vitest';
import {
  deriveActivity,
  deriveEnergy,
  deriveInterruption,
  describeContext,
  type ContextSnapshot,
} from '../context';
import { computeFocusScore } from '../dashboard';

describe('context derivations', () => {
  it('maps categories to human activities', () => {
    expect(deriveActivity('coding')).toBe('writing or reviewing code');
    expect(deriveActivity('career')).toBe('job / internship hunting');
    expect(deriveActivity(null)).toBeNull();
    expect(deriveActivity('other')).toBe('browsing'); // unmapped fallback
  });

  it('reads interruption from switching + dwell', () => {
    expect(deriveInterruption(0, 0, false)).toBe('idle');
    expect(deriveInterruption(8, 20 * 60000, true)).toBe('switching');
    expect(deriveInterruption(1, 15 * 60000, true)).toBe('focused');
    expect(deriveInterruption(0, 60000, true)).toBe('switching'); // present but not settled yet
  });

  it('estimates energy from hours active and time of day', () => {
    expect(deriveEnergy(30 * 60000, 10)).toBe('fresh');
    expect(deriveEnergy(3 * 3600000, 14)).toBe('steady');
    expect(deriveEnergy(6 * 3600000, 16)).toBe('fatigued');
    expect(deriveEnergy(10 * 60000, 2)).toBe('fatigued'); // 2am
  });
});

describe('describeContext', () => {
  const base: ContextSnapshot = {
    currentWebsite: 'github.com',
    currentPage: '/nomi/pull/42',
    currentCategory: 'coding',
    currentActivity: 'writing or reviewing code',
    focusDurationMs: 42 * 60000,
    openTabs: 8,
    currentGoal: 'land an internship',
    currentProject: null,
    currentTask: null,
    energyEstimate: 'steady',
    interruptionState: 'focused',
  };

  it('renders the live line with duration, tabs and state', () => {
    const line = describeContext(base)!;
    expect(line).toContain('github.com');
    expect(line).toContain('42 min');
    expect(line).toContain('8 tabs');
    expect(line).toContain('focused');
  });

  it('stays silent when nothing is in focus', () => {
    expect(
      describeContext({ ...base, currentWebsite: null, interruptionState: 'idle' }),
    ).toBeNull();
  });
});

describe('computeFocusScore', () => {
  it('is zero on an essentially idle day', () => {
    expect(computeFocusScore(0, 0, 0)).toBe(0);
  });

  it('rewards a long settled stretch', () => {
    const deep = computeFocusScore(45 * 60000, 60 * 60000, 4);
    const shallow = computeFocusScore(5 * 60000, 60 * 60000, 4);
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeLessThanOrEqual(100);
  });

  it('penalizes heavy tab churn', () => {
    const calm = computeFocusScore(20 * 60000, 3600000, 3);
    const frantic = computeFocusScore(20 * 60000, 3600000, 40);
    expect(frantic).toBeLessThan(calm);
    expect(frantic).toBeGreaterThanOrEqual(0);
  });
});
