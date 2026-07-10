import { describe, expect, it } from 'vitest';
import { searchDocs, type NomiDoc } from '../docs';

const doc = (name: string, text: string): NomiDoc => ({
  id: name,
  name,
  kind: 'text',
  text,
  chars: text.length,
  ts: 0,
});

describe('searchDocs (Nomi Space retrieval)', () => {
  const docs = [
    doc(
      'resume.pdf',
      'Ayush Kumar\n\nExperience\nSoftware engineer at Acme building React apps and Node services.\n\nSkills\nTypeScript, Python, distributed systems, Postgres.',
    ),
    doc('notes.txt', 'Meeting with the design team on Thursday about the onboarding flow.'),
  ];

  it('finds the passage that answers the question', () => {
    const hits = searchDocs('what are my skills?', docs);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].docName).toBe('resume.pdf');
    expect(hits[0].passage.toLowerCase()).toMatch(/typescript|skills/);
  });

  it('retrieves from the right document', () => {
    const hits = searchDocs('when is the design meeting?', docs);
    expect(hits[0].docName).toBe('notes.txt');
    expect(hits[0].passage).toMatch(/Thursday/);
  });

  it('returns nothing when the query has no overlap', () => {
    expect(searchDocs('what is the weather on mars', docs)).toEqual([]);
  });

  it('ranks by relevance', () => {
    const hits = searchDocs('React Node engineer', docs);
    expect(hits[0].docName).toBe('resume.pdf');
  });
});
