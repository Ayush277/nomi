import { describe, expect, it } from 'vitest';
import { cosine, hybridScore, quantize, rankHybrid } from '../rag';

describe('cosine', () => {
  it('is 1 for identical vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is scale-invariant', () => {
    expect(cosine([1, 2], [10, 20])).toBeCloseTo(1);
  });

  it('returns 0 on mismatched or empty input instead of NaN', () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('quantize', () => {
  it('rounds to 4 decimals without changing ranking-relevant magnitude', () => {
    const v = quantize([0.123456789, -0.00004]);
    expect(v[0]).toBe(0.1235);
    expect(v[1]).toBe(-0);
  });
});

describe('hybridScore', () => {
  it('weights semantic similarity above keyword overlap', () => {
    expect(hybridScore(1, 0)).toBeGreaterThan(hybridScore(0, 3));
  });

  it('saturates keyword contribution at 3 matched terms', () => {
    expect(hybridScore(0, 3)).toBeCloseTo(hybridScore(0, 30));
  });

  it('never rewards negative similarity', () => {
    expect(hybridScore(-0.9, 1)).toBeCloseTo(hybridScore(0, 1));
  });
});

describe('rankHybrid', () => {
  const q = [1, 0];

  it('ranks a semantically close passage above a keyword-only one', () => {
    const ranked = rankHybrid(q, [[0.95, 0.1], [0, 1]], [0, 2], 5);
    expect(ranked[0].idx).toBe(0);
    expect(ranked[1].idx).toBe(1);
  });

  it('works keyword-only when no vectors exist (fallback path)', () => {
    const ranked = rankHybrid(null, [null, null], [0, 2], 5);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].idx).toBe(1);
  });

  it('filters passages with neither signal, so answers never ground on noise', () => {
    const ranked = rankHybrid(q, [[0.1, 0.9], null], [0.5, 0], 5);
    expect(ranked).toHaveLength(0);
  });

  it('respects the limit', () => {
    const vecs = [[1, 0], [0.9, 0.1], [0.8, 0.2]];
    expect(rankHybrid(q, vecs, [0, 0, 0], 2)).toHaveLength(2);
  });
});
