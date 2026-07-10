import { describe, expect, it } from 'vitest';
import { countEntries, isCountQuery, parseLog, type JournalEntry } from '../journal';

describe('parseLog', () => {
  it('catches natural first-person actions', () => {
    expect(parseLog('I applied to a job')).toBe('I applied to a job');
    expect(parseLog('i just finished the essay')).toBe('i just finished the essay');
    expect(parseLog('I solved two lc problems')).toBe('I solved two lc problems');
  });

  it('catches explicit log/note commands', () => {
    expect(parseLog('log that I went to the gym')).toBe('I went to the gym');
    expect(parseLog('note: applied at Google')).toBe('applied at Google');
  });

  it('ignores questions and non-actions', () => {
    expect(parseLog('how many jobs did I apply to?')).toBeNull();
    expect(parseLog('what can you do')).toBeNull();
  });
});

describe('isCountQuery', () => {
  it('spots counting questions', () => {
    expect(isCountQuery('how many jobs did I apply to?')).toBe(true);
    expect(isCountQuery('how much did I code this week')).toBe(true);
    expect(isCountQuery('tell me a joke')).toBe(false);
  });
});

describe('countEntries', () => {
  const now = new Date('2026-07-11T12:00:00').getTime();
  const day = 86400000;
  const entries: JournalEntry[] = [
    { id: '1', text: 'I applied to a job at Google', ts: now - 2 * day },
    { id: '2', text: 'I applied to a job at Meta', ts: now - 1 * day },
    { id: '3', text: 'I went to the gym', ts: now - 10 * day },
    { id: '4', text: 'applied to a job at Stripe', ts: now - 1000 },
  ];

  it('counts by keyword across all time', () => {
    const r = countEntries('how many jobs did I apply to?', entries, now);
    expect(r.count).toBe(3);
    expect(r.window).toBe('ever');
  });

  it('honors a this-week window', () => {
    const r = countEntries('how many jobs this week?', entries, now);
    expect(r.count).toBe(3); // all job entries are within 7 days except none older
    expect(r.window).toBe('this week');
  });

  it('separates unrelated activities', () => {
    expect(countEntries('how many gym sessions', entries, now).count).toBe(1);
  });
});
