import { describe, expect, it } from 'vitest';
import { describeConnections, KNOWN_TOOLS, resolveTool, type Connections } from '../connect';

describe('resolveTool', () => {
  it('recognizes known tools with an open URL', () => {
    expect(resolveTool('notion')).toEqual({ key: 'notion', name: 'Notion', url: 'https://www.notion.so' });
    expect(resolveTool('my Obsidian')?.name).toBe('Obsidian');
    expect(resolveTool('google calendar')?.url).toBe('https://calendar.google.com');
    expect(KNOWN_TOOLS.github.url).toContain('github.com');
  });

  it('links an unknown-but-nameable tool without a URL', () => {
    const r = resolveTool('freebird')!;
    expect(r.key).toBe('freebird');
    expect(r.name).toBe('Freebird');
    expect(r.url).toBeUndefined();
  });

  it('rejects empty / absurd input', () => {
    expect(resolveTool('')).toBeNull();
    expect(resolveTool('x'.repeat(40))).toBeNull();
  });
});

describe('describeConnections', () => {
  it('summarizes stats and linked tools for the model', () => {
    const c: Connections = {
      leetcode: { username: 'ayush', total: 210, easy: 100, medium: 90, hard: 20, syncedTs: 0 },
      github: { username: 'ayush277', repos: 14, followers: 30, recentCommits: 42, syncedTs: 0 },
      tools: [
        { id: '1', key: 'notion', name: 'Notion', url: 'https://www.notion.so', addedTs: 0 },
        { id: '2', key: 'obsidian', name: 'Obsidian', addedTs: 0 },
      ],
    };
    const s = describeConnections(c);
    expect(s).toContain('LeetCode @ayush: 210 solved (20 hard)');
    expect(s).toContain('GitHub @ayush277');
    expect(s).toContain('Notion (https://www.notion.so)');
    expect(s).toContain('Obsidian');
  });

  it('is honest when nothing is linked', () => {
    expect(describeConnections({})).toMatch(/No accounts or tools linked/i);
  });
});
