import { describe, expect, it } from 'vitest';
import { validateSignal } from '../adapters';

describe('validateSignal — the ADR-5 choke point', () => {
  const good = {
    adapter: 'leetcode',
    kind: 'submission_accepted',
    data: { slug: 'two-sum', difficulty: 'Easy' },
  };

  it('accepts a well-formed signal', () => {
    expect(validateSignal(good)).toEqual(good);
  });

  it('rejects unknown adapters and kinds outright', () => {
    expect(validateSignal({ ...good, adapter: 'facebook' })).toBeNull();
    expect(validateSignal({ ...good, kind: 'page_content' })).toBeNull();
  });

  it('silently drops fields outside the contract', () => {
    const smuggled = validateSignal({
      ...good,
      data: { ...good.data, pageText: 'entire DOM here', cookies: 'session=abc' },
    });
    expect(smuggled?.data).toEqual(good.data);
  });

  it('rejects wrong types, oversize values, and out-of-enum values', () => {
    expect(validateSignal({ ...good, data: { slug: 42, difficulty: 'Easy' } })).toBeNull();
    expect(
      validateSignal({ ...good, data: { slug: 'x'.repeat(200), difficulty: 'Easy' } }),
    ).toBeNull();
    expect(validateSignal({ ...good, data: { slug: 'two-sum', difficulty: 'Trivial' } })).toBeNull();
  });

  it('rejects malformed envelopes', () => {
    expect(validateSignal({})).toBeNull();
    expect(validateSignal({ adapter: 'leetcode', kind: 'submission_accepted', data: null })).toBeNull();
  });
});
