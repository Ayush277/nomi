import { describe, expect, it } from 'vitest';
import { calc, tryUtility } from '../utilities';

describe('calc — safe arithmetic', () => {
  it('evaluates expressions with precedence and parens', () => {
    expect(calc('12 * 8')).toBe(96);
    expect(calc('2400 / 3')).toBe(800);
    expect(calc('(3 + 4) * 2')).toBe(14);
    expect(calc('2 ^ 10')).toBe(1024);
    expect(calc('10 % 3')).toBe(1);
    expect(calc('-5 + 3')).toBe(-2);
  });

  it('returns null on malformed input (never throws / evals)', () => {
    expect(calc('2 +')).toBeNull();
    expect(calc('(1 + 2')).toBeNull();
    expect(calc('alert(1)')).toBeNull();
    expect(calc('1/0')).toBeNull(); // Infinity → rejected
  });
});

describe('tryUtility', () => {
  const NOW = new Date(2026, 6, 12, 12, 0, 0).getTime(); // 2026-07-12

  it('does percentages', () => {
    expect(tryUtility("what's 15% of 2400")).toBe('360');
    expect(tryUtility('20 percent of 50')).toBe('10');
  });

  it('does arithmetic only when it clearly is math', () => {
    expect(tryUtility('what is 12 * 8')).toBe('96');
    expect(tryUtility('calculate (3+4)^2')).toBe('49');
    expect(tryUtility('how is today going?')).toBeNull(); // not math
    expect(tryUtility('remind me in 5 minutes')).toBeNull();
  });

  it('converts units (length, weight, temperature)', () => {
    expect(tryUtility('5 km in miles')).toMatch(/3\.10/);
    expect(tryUtility('10 kg to lb')).toMatch(/22\.04/);
    expect(tryUtility('100 f to c')).toMatch(/37\.8/);
    expect(tryUtility('0 c to f')).toMatch(/32/);
  });

  it('converts timezones (approximate, fixed offset)', () => {
    const r = tryUtility('3pm PST in IST')!;
    expect(r).toContain('IST');
    expect(r).toMatch(/4:30am/); // PST 3pm +13:30 = 4:30am IST
  });

  it('counts days until a date', () => {
    expect(tryUtility('days until 2026-07-15', NOW)).toBe('3 days until 2026-07-15.');
    expect(tryUtility('how many days until Jul 12', NOW)).toBe("That's today.");
    expect(tryUtility('days until Aug 1', NOW)).toMatch(/20 days/);
  });

  it('returns null for anything that is not a utility', () => {
    expect(tryUtility('summarize this page')).toBeNull();
    expect(tryUtility('hello there')).toBeNull();
    expect(tryUtility('what did I do yesterday')).toBeNull();
  });
});
