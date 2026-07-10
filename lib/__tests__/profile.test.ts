import { describe, expect, it } from 'vitest';
import { parseName, parseRemember } from '../profile';

describe('parseRemember', () => {
  it('captures facts about the user', () => {
    expect(parseRemember('remember that I am prepping for FAANG')).toBe('prepping for FAANG');
    expect(parseRemember("remember I'm vegetarian")).toBe('vegetarian');
    expect(parseRemember('Nomi, remember my dog is named Miso')).toBe('my dog is named Miso');
  });

  it('ignores reminders ("remember to …")', () => {
    expect(parseRemember('remember to call mom')).toBeNull();
  });

  it('ignores non-remember messages', () => {
    expect(parseRemember('how is today going?')).toBeNull();
  });
});

describe('parseName', () => {
  it('spots a stated name', () => {
    expect(parseName("i'm Ayush")).toBe('Ayush');
    expect(parseName('my name is Sofia')).toBe('Sofia');
    expect(parseName('call me Max please')).toBe('Max');
  });

  it("doesn't mistake feelings/states for names", () => {
    expect(parseName("i'm fine")).toBeNull();
    expect(parseName("i'm tired")).toBeNull();
    expect(parseName("i'm working on it")).toBeNull();
  });

  it('returns null when no name is present', () => {
    expect(parseName('what can you do?')).toBeNull();
  });
});
