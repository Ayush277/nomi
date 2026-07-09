import { describe, expect, it } from 'vitest';
import { categorize, isSensitive, observableUrl, sanitizeUrl } from '../privacy';

describe('sanitizeUrl', () => {
  it('keeps only hostname and pathname', () => {
    expect(
      sanitizeUrl('https://leetcode.com/problems/two-sum/?envType=daily#comments'),
    ).toEqual({ domain: 'leetcode.com', path: '/problems/two-sum/' });
  });

  it('strips query strings that could carry tokens or search terms', () => {
    const clean = sanitizeUrl('https://example.com/reset?token=SECRET&email=a@b.c');
    expect(JSON.stringify(clean)).not.toContain('SECRET');
    expect(JSON.stringify(clean)).not.toContain('a@b.c');
  });

  it('rejects non-http(s) URLs entirely', () => {
    expect(sanitizeUrl('chrome://extensions')).toBeNull();
    expect(sanitizeUrl('about:blank')).toBeNull();
    expect(sanitizeUrl('file:///Users/me/taxes.pdf')).toBeNull();
    expect(sanitizeUrl('chrome-extension://abc/popup.html')).toBeNull();
  });

  it('handles garbage without throwing', () => {
    expect(sanitizeUrl('')).toBeNull();
    expect(sanitizeUrl(undefined)).toBeNull();
    expect(sanitizeUrl('not a url')).toBeNull();
  });
});

describe('categorize', () => {
  it('maps known domains', () => {
    expect(categorize('leetcode.com')).toBe('coding');
    expect(categorize('linkedin.com')).toBe('career');
  });

  it('matches subdomains via suffix', () => {
    expect(categorize('gist.github.com')).toBe('coding');
  });

  it('prefers the most specific entry', () => {
    expect(categorize('youtube.com')).toBe('entertainment');
    expect(categorize('music.youtube.com')).toBe('music');
  });

  it('does not treat lookalike domains as matches', () => {
    expect(categorize('notgithub.com')).toBe('other');
  });

  it('falls back to other', () => {
    expect(categorize('some-random-blog.dev')).toBe('other');
  });
});

describe('isSensitive', () => {
  it('blocks the built-in sensitive list, including subdomains', () => {
    expect(isSensitive('chase.com')).toBe(true);
    expect(isSensitive('secure.chase.com')).toBe(true);
    expect(isSensitive('mail.google.com')).toBe(true);
  });

  it('does not block ordinary sites', () => {
    expect(isSensitive('github.com')).toBe(false);
    expect(isSensitive('google.com')).toBe(false); // only mail.google.com is blocked
  });

  it('honors user exclusions case-insensitively', () => {
    expect(isSensitive('mysite.com', ['MySite.com'])).toBe(true);
  });
});

describe('observableUrl (the single gate)', () => {
  it('passes ordinary pages with a category', () => {
    expect(observableUrl('https://leetcode.com/problems/lru-cache/')).toEqual({
      domain: 'leetcode.com',
      path: '/problems/lru-cache/',
      category: 'coding',
    });
  });

  it('returns null for sensitive domains — no event may exist at all', () => {
    expect(observableUrl('https://secure.chase.com/dashboard')).toBeNull();
  });

  it('returns null for user-excluded domains', () => {
    expect(observableUrl('https://myjournal.app/entry/1', ['myjournal.app'])).toBeNull();
  });

  it('returns null for browser-internal pages', () => {
    expect(observableUrl('chrome://newtab')).toBeNull();
  });
});
