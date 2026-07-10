import { describe, expect, it } from 'vitest';
import { isRecallLinks, isSaveLink, searchLinks, type SavedLink } from '../bag';

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
