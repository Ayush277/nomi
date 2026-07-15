import { describe, expect, it } from 'vitest';
import { isRecallLinks, isRemoveLink, isSaveLink, searchLinks, type SavedLink } from '../bag';

describe('bag intents', () => {
  it('detects save-link phrasings', () => {
    expect(isSaveLink('remember this link')).toBe(true);
    expect(isSaveLink('save this page')).toBe(true);
    expect(isSaveLink('bag this article')).toBe(true);
    expect(isSaveLink('how is today going')).toBe(false);
  });

  it('detects recall phrasings', () => {
    expect(isRecallLinks('what links did I save?')).toBe(true);
    expect(isRecallLinks('show me my saved pages')).toBe(true);
    expect(isRecallLinks('give me the link about react')).toBe(true);
  });

  it('detects remove phrasings (and not saves)', () => {
    expect(isRemoveLink('delete the link about react')).toBe(true);
    expect(isRemoveLink('remove that saved page')).toBe(true);
    expect(isRemoveLink('forget the link about taxes')).toBe(true);
    expect(isRemoveLink('clear my bag')).toBe(true);
    expect(isRemoveLink('save this link')).toBe(false);
    expect(isRemoveLink('how is today going')).toBe(false);
  });

  it('search ignores remove verbs so "delete the react link" still finds react', () => {
    const links: SavedLink[] = [
      { id: '1', url: 'https://react.dev', title: 'React Hooks', domain: 'react.dev', ts: 100 },
      { id: '2', url: 'https://a.com', title: 'Taxes', domain: 'a.com', ts: 200 },
    ];
    expect(searchLinks('delete the react link', links)[0]?.id).toBe('1');
  });
});

describe('searchLinks', () => {
  const links: SavedLink[] = [
    { id: '1', url: 'https://react.dev/hooks', title: 'React Hooks', domain: 'react.dev', ts: 100 },
    { id: '2', url: 'https://a.com', title: 'Tax filing guide', domain: 'a.com', ts: 200 },
    { id: '3', url: 'https://b.com', title: 'Nomi launch plan', domain: 'b.com', ts: 300 },
  ];

  it('finds by title keyword', () => {
    expect(searchLinks('the link about react', links)[0].id).toBe('1');
    expect(searchLinks('tax link', links)[0].id).toBe('2');
  });

  it('returns newest first when no keyword', () => {
    expect(searchLinks('my links', links)[0].id).toBe('3');
  });
});
