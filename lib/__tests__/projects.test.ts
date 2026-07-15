import { describe, expect, it } from 'vitest';
import { inferProject, parseProjectCommand, type Project } from '../projects';

const project = (name: string, keywords: string[]): Project => ({
  id: name,
  name,
  keywords,
  createdTs: 0,
  lastSeenTs: 0,
});

describe('inferProject', () => {
  it('matches a user project by name or keyword anywhere in the page', () => {
    const projects = [project('Resume', ['overleaf', 'cv']), project('Nomi', ['wxt'])];
    expect(inferProject({ domain: 'overleaf.com', path: '/project/abc' }, projects)).toBe('Resume');
    expect(inferProject({ domain: 'docs.google.com', title: 'My Resume 2026' }, projects)).toBe('Resume');
    expect(inferProject({ domain: 'github.com', path: '/me/nomi' }, projects)).toBe('Nomi');
  });

  it('auto-detects a GitHub repo as a project when nothing user-defined matches', () => {
    expect(inferProject({ domain: 'github.com', path: '/ayush/segment-x/pull/3' }, [])).toBe('segment x');
    // Non-repo GitHub pages do not become projects.
    expect(inferProject({ domain: 'github.com', path: '/settings/profile' }, [])).toBeNull();
    expect(inferProject({ domain: 'github.com', path: '/notifications' }, [])).toBeNull();
  });

  it('returns null when nothing is inferable', () => {
    expect(inferProject({ domain: 'news.ycombinator.com', path: '/' }, [])).toBeNull();
  });
});

describe('parseProjectCommand', () => {
  it('extracts a project name from natural phrasings', () => {
    expect(parseProjectCommand("I'm working on Nomi")).toBe('Nomi');
    expect(parseProjectCommand('call this the Portfolio project')).toBe('Portfolio');
    expect(parseProjectCommand('tag this as Google Internship')).toBe('Google Internship');
  });

  it('ignores unrelated messages', () => {
    expect(parseProjectCommand('how is today going?')).toBeNull();
    expect(parseProjectCommand('working')).toBeNull();
  });
});
