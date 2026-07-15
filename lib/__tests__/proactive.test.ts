import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROACTIVE_STATE,
  markReacted,
  parseReaction,
  PROACTIVE_COOLDOWN_MS,
  shouldReact,
} from '../proactive';

const screen = (label: string, text = 'x'.repeat(80)) => ({ label, text });

describe('shouldReact — the anti-spam gate', () => {
  it('reacts on a fresh context with enough text', () => {
    expect(shouldReact(EMPTY_PROACTIVE_STATE, 1_000_000, screen('leetcode.com — "Two Sum"'))).toBe(
      true,
    );
  });

  it('stays quiet on near-empty pages', () => {
    expect(shouldReact(EMPTY_PROACTIVE_STATE, 1_000_000, screen('blank.com', 'hi'))).toBe(false);
  });

  it('respects the cooldown', () => {
    const state = markReacted(1_000_000, 'a.com — "One"');
    // Different context but still inside the cooldown window → no.
    expect(shouldReact(state, 1_000_000 + PROACTIVE_COOLDOWN_MS - 1, screen('b.com — "Two"'))).toBe(
      false,
    );
    // Past the cooldown, new context → yes.
    expect(shouldReact(state, 1_000_000 + PROACTIVE_COOLDOWN_MS + 1, screen('b.com — "Two"'))).toBe(
      true,
    );
  });

  it('does not re-react to the same context after the cooldown', () => {
    const state = markReacted(1_000_000, 'a.com — "One"');
    expect(
      shouldReact(state, 1_000_000 + PROACTIVE_COOLDOWN_MS + 1, screen('a.com — "One"')),
    ).toBe(false);
  });
});

describe('parseReaction — what actually gets said', () => {
  it('drops the PASS sentinel and empties', () => {
    expect(parseReaction('PASS')).toBeNull();
    expect(parseReaction('  pass  ')).toBeNull();
    expect(parseReaction('')).toBeNull();
  });

  it('returns a clean short remark, stripping wrapping quotes', () => {
    expect(parseReaction('"Nice, that PR merged 🎉"')).toBe('Nice, that PR merged 🎉');
  });

  it('refuses ramble and surveillance-flavored replies', () => {
    expect(parseReaction('word '.repeat(60))).toBeNull();
    expect(parseReaction("I'm watching your screen right now.")).toBeNull();
    expect(parseReaction('I am tracking what you do here.')).toBeNull();
  });
});
