import { describe, expect, it } from 'vitest';
import { confirmText, extractDelay, parseReminder } from '../reminders';

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

  it('defaults to 30 minutes when no time is given — and says so', () => {
    const r = parseReminder('remind me to drink water')!;
    expect(r).toEqual({ what: 'drink water', delayMs: 30 * 60000, defaulted: true });
    expect(confirmText(r)).toContain("didn't say when");
  });

  it('ignores non-reminder messages', () => {
    expect(parseReminder("how's today going?")).toBeNull();
    expect(parseReminder('remind me')).toBeNull();
  });

  it('understands spoken word-number durations — the "in one hour" bug', () => {
    // Regression: "in one hour" used to silently become a 30-minute default.
    expect(parseReminder('Hey, remind me to drink water in one hour.')).toEqual({
      what: 'drink water',
      delayMs: 3600000,
    });
    expect(parseReminder('remind me to stretch in an hour')?.delayMs).toBe(3600000);
    expect(parseReminder('remind me to stretch in half an hour')?.delayMs).toBe(30 * 60000);
    expect(parseReminder('remind me to call in 1 hour 30 minutes')?.delayMs).toBe(90 * 60000);
    expect(parseReminder('remind me to rest in 1.5 hours')?.delayMs).toBe(90 * 60000);
  });

  it('lets the LAST duration win in a self-correction, and cleans the task text', () => {
    const r = parseReminder('remind me to drink water not in 1 hour, in 30 minutes')!;
    expect(r.delayMs).toBe(30 * 60000);
    expect(r.what).toBe('drink water'); // no "not", no leftover time words
  });

  it('returns null for a pure time-correction with no task (caller retimes)', () => {
    // The transcript case: all negations and times, no actual task.
    expect(parseReminder('remind me not in 1 hour 30 minutes, in 30 minutes, not')).toBeNull();
  });

  it('parses "remind me in X to Y" order too', () => {
    expect(parseReminder('remind me in 30 minutes to drink water')).toEqual({
      what: 'drink water',
      delayMs: 30 * 60000,
    });
  });

  it('extractDelay pulls the last duration from a bare correction', () => {
    expect(extractDelay('No, no, not in 1 hour 30 minutes, in 30 minutes')).toBe(30 * 60000);
    expect(extractDelay('actually make it in an hour')).toBe(3600000);
    expect(extractDelay('how is today going?')).toBeNull();
  });

  it('keeps a genuine mid-sentence "not" in the task', () => {
    expect(parseReminder('remind me to not forget the keys in 10 minutes')?.what).toBe(
      'not forget the keys',
    );
  });

  it('refuses absolute times it cannot parse rather than inventing a timer', () => {
    // Regression: these used to silently become a bogus 30-minute reminder.
    expect(parseReminder('remind me on 11th of July at 11am to reply')).toBeNull();
    expect(parseReminder('remind me to call mom at 5pm')).toBeNull();
    expect(parseReminder('remind me to submit taxes tomorrow')).toBeNull();
    expect(parseReminder('remind me about the meeting on the 3rd')).toBeNull();
  });

  it('confirms in companion voice', () => {
    const r = parseReminder('remind me to stretch in 20 minutes')!;
    expect(confirmText(r)).toContain('stretch');
    expect(confirmText(r)).toContain('20 minutes');
  });
});
