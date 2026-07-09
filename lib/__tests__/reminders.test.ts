import { describe, expect, it } from 'vitest';
import { confirmText, parseReminder } from '../reminders';

describe('parseReminder', () => {
  it('parses "remind me to X in N minutes"', () => {
    expect(parseReminder('remind me to stretch in 20 minutes')).toEqual({
      what: 'stretch',
      delayMs: 20 * 60000,
    });
  });

  it('handles hours, seconds, and shorthand units', () => {
    expect(parseReminder('remind me about the standup in 1 hour')?.delayMs).toBe(3600000);
    expect(parseReminder('Remind me to check the oven in 90s')?.delayMs).toBe(90000);
    expect(parseReminder('remind me to push the branch in 5 min')?.delayMs).toBe(5 * 60000);
  });

  it('defaults to 30 minutes when no time is given', () => {
    expect(parseReminder('remind me to drink water')).toEqual({
      what: 'drink water',
      delayMs: 30 * 60000,
    });
  });

  it('ignores non-reminder messages', () => {
    expect(parseReminder("how's today going?")).toBeNull();
    expect(parseReminder('remind me')).toBeNull();
  });

  it('confirms in companion voice', () => {
    const r = parseReminder('remind me to stretch in 20 minutes')!;
    expect(confirmText(r)).toContain('stretch');
    expect(confirmText(r)).toContain('20m');
  });
});
