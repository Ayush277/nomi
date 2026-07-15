import { describe, expect, it } from 'vitest';
import { analyzeStudyDrift, isStudyContent } from '../insights';
import type { VisitSession } from '../types';

const T0 = new Date('2026-07-14T10:00:00').getTime();
const MIN = 60000;

function s(over: Partial<VisitSession>): VisitSession {
  return {
    id: Math.random().toString(36).slice(2),
    domain: 'leetcode.com',
    category: 'coding',
    startTs: T0,
    endTs: T0 + 30 * MIN,
    durationMs: 30 * MIN,
    ...over,
  };
}

describe('isStudyContent', () => {
  const vocab = new Set(['react', 'leetcode', 'binary']);
  it('matches the study vocabulary and generic learning words', () => {
    expect(isStudyContent('React Hooks deep dive', vocab)).toBe(true);
    expect(isStudyContent('Binary search explained', vocab)).toBe(true);
    expect(isStudyContent('System design tutorial', vocab)).toBe(true);
  });
  it('rejects unrelated entertainment', () => {
    expect(isStudyContent('Top 10 funniest cat moments', vocab)).toBe(false);
  });
});

describe('analyzeStudyDrift', () => {
  it('needs a real study block', () => {
    expect(analyzeStudyDrift([s({ durationMs: 5 * MIN })], [])).toBeNull();
  });

  it('reports a clean block when nothing else was open', () => {
    const r = analyzeStudyDrift([s({})], [])!;
    expect(r.studyMs).toBe(30 * MIN);
    expect(r.watchMs).toBe(0);
  });

  it('splits interleaved YouTube into study content vs drift by what was on screen', () => {
    const sessions = [
      s({ startTs: T0, endTs: T0 + 60 * MIN, durationMs: 60 * MIN, domain: 'leetcode.com', path: '/problems/binary-search' }),
      // watched a matching tutorial mid-block
      s({ category: 'entertainment', domain: 'youtube.com', startTs: T0 + 20 * MIN, endTs: T0 + 30 * MIN, durationMs: 10 * MIN }),
      // then drifted
      s({ category: 'entertainment', domain: 'youtube.com', startTs: T0 + 40 * MIN, endTs: T0 + 48 * MIN, durationMs: 8 * MIN }),
    ];
    const videos = [
      { title: 'Binary Search in 15 minutes', ts: T0 + 22 * MIN },
      { title: 'Top 10 funniest cat moments', ts: T0 + 41 * MIN },
    ];
    const r = analyzeStudyDrift(sessions, videos)!;
    expect(r.studyMs).toBe(60 * MIN);
    expect(r.watchMs).toBe(18 * MIN);
    expect(r.relatedMs).toBe(10 * MIN);
    expect(r.driftMs).toBe(8 * MIN);
    expect(r.related).toContain('Binary Search in 15 minutes');
    expect(r.drift).toContain('Top 10 funniest cat moments');
  });

  it('counts watch time with NO captured title as drift, naming the domain', () => {
    const sessions = [
      s({ startTs: T0, endTs: T0 + 40 * MIN, durationMs: 40 * MIN }),
      s({ category: 'social', domain: 'x.com', startTs: T0 + 10 * MIN, endTs: T0 + 18 * MIN, durationMs: 8 * MIN }),
    ];
    const r = analyzeStudyDrift(sessions, [])!;
    expect(r.driftMs).toBe(8 * MIN);
    expect(r.drift).toContain('x.com');
  });

  it('ignores watching far outside the study window', () => {
    const sessions = [
      s({ startTs: T0, endTs: T0 + 30 * MIN, durationMs: 30 * MIN }),
      s({ category: 'entertainment', domain: 'youtube.com', startTs: T0 + 5 * 3600000, endTs: T0 + 5 * 3600000 + 20 * MIN, durationMs: 20 * MIN }),
    ];
    const r = analyzeStudyDrift(sessions, [])!;
    expect(r.watchMs).toBe(0);
  });
});
