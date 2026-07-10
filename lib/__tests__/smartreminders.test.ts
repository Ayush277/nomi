import { describe, expect, it } from 'vitest';
import { matchSiteReminder, parseSiteReminder } from '../smartreminders';

describe('parseSiteReminder', () => {
  it('parses the Gmail example from the vision doc', () => {
    expect(parseSiteReminder('remind me tomorrow when I open Gmail to reply to the Anthropic email')).toEqual({
      domain: 'mail.google.com',
      what: 'reply to the Anthropic email',
    });
  });

  it('handles site aliases and raw domains', () => {
    expect(parseSiteReminder('remind me when I visit github to star the repo')?.domain).toBe('github.com');
    expect(parseSiteReminder('remind me when I open notion.so to write notes')?.domain).toBe('notion.so');
  });

  it('ignores plain time reminders', () => {
    expect(parseSiteReminder('remind me to stretch in 20 minutes')).toBeNull();
  });
});

describe('matchSiteReminder', () => {
  const rem = { r1: { domain: 'mail.google.com', what: 'reply', createdTs: 0 } };

  it('fires on the matching domain after the grace period', () => {
    const hit = matchSiteReminder('mail.google.com', rem, 120000);
    expect(hit?.reminder.what).toBe('reply');
  });

  it("doesn't fire on the page where it was just set", () => {
    expect(matchSiteReminder('mail.google.com', rem, 5000)).toBeNull();
  });

  it("doesn't fire on unrelated sites", () => {
    expect(matchSiteReminder('youtube.com', rem, 120000)).toBeNull();
  });
});
