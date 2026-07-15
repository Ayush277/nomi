import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, PERSONALITIES } from '../persona';
import { DEFAULT_PROFILE } from '../profile';

describe('buildSystemPrompt', () => {
  it('always establishes Nomi and the never-control rule', () => {
    const p = buildSystemPrompt({ profile: DEFAULT_PROFILE, todayContext: 'quiet so far' });
    expect(p).toMatch(/You are Nomi/);
    expect(p).toMatch(/never control/i);
    expect(p).toMatch(/quiet so far/);
  });

  it('adds a Hinglish instruction only when language is hinglish', () => {
    const en = buildSystemPrompt({ profile: DEFAULT_PROFILE, todayContext: 'x', language: 'en' });
    expect(en).not.toMatch(/hinglish/i);

    const hi = buildSystemPrompt({ profile: DEFAULT_PROFILE, todayContext: 'x', language: 'hinglish' });
    expect(hi).toMatch(/reply in Hinglish/i);
    expect(hi).toMatch(/Roman|Latin/i);
    expect(hi).toMatch(/Never use Devanagari/i);
  });

  it('weaves in name, goal, and facts when known', () => {
    const p = buildSystemPrompt({
      profile: {
        ...DEFAULT_PROFILE,
        name: 'Ayush',
        goal: 'ship Nomi',
        facts: [{ id: '1', text: 'loves matcha', ts: 0 }],
      },
      todayContext: 'coding',
    });
    expect(p).toMatch(/Their name is Ayush/);
    expect(p).toMatch(/working toward: ship Nomi/);
    expect(p).toMatch(/loves matcha/);
  });

  it('includes the live screen when provided', () => {
    const p = buildSystemPrompt({
      profile: DEFAULT_PROFILE,
      todayContext: 'x',
      screenContext: 'leetcode.com — "Two Sum"',
    });
    expect(p).toMatch(/looking at: leetcode\.com/);
    expect(p).toMatch(/Two Sum/);
  });

  it('each personality has a distinct voice', () => {
    const voices = Object.values(PERSONALITIES).map((p) => p.voice);
    expect(new Set(voices).size).toBe(voices.length);
    const strict = buildSystemPrompt({
      profile: { ...DEFAULT_PROFILE, personality: 'strict' },
      todayContext: 'x',
    });
    expect(strict).toMatch(/blunt|direct|no-nonsense/i);
  });
});
