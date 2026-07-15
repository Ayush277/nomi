import { describe, expect, it } from 'vitest';
import { matchIntentions, parseIntent, type Intention } from '../intents';

describe('parseIntent', () => {
  it('captures "I should / need to" as a medium/high intention', () => {
    const r = parseIntent('I should reply to the recruiter')!;
    expect(r.title).toBe('reply to the recruiter');
    expect(r.priority).toBe('medium');
    expect(r.estimatedEffort).toBe('quick');

    const urgent = parseIntent('I need to finish the resume')!;
    expect(urgent.priority).toBe('high'); // "need to"
    expect(urgent.estimatedEffort).toBe('deep'); // "finish"
    expect(urgent.title).toBe('finish the resume');
  });

  it('captures "…later" and "come back to this"', () => {
    expect(parseIntent("I'll read this later")!.title).toContain('read');
    expect(parseIntent('read this later')!.priority).toBe('low');
    expect(parseIntent('come back to this')!.title).toBe('come back to this');
  });

  it('captures note-to-self and soft "looks useful"', () => {
    expect(parseIntent('note to self: renew the domain')!.title).toBe('renew the domain');
    const soft = parseIntent('this looks useful')!;
    expect(soft.confidence).toBeLessThan(0.6);
  });

  it('ignores plain statements and questions', () => {
    expect(parseIntent('how is today going?')).toBeNull();
    expect(parseIntent('I applied to a job')).toBeNull(); // journal territory, not an intention
    expect(parseIntent('the weather is nice')).toBeNull();
  });
});

describe('matchIntentions (retrieval)', () => {
  const mk = (title: string, status: Intention['status'] = 'open'): Intention => ({
    id: title,
    title,
    confidence: 0.8,
    priority: 'medium',
    deadline: null,
    status,
    relatedProject: null,
    estimatedEffort: 'quick',
    createdTs: 0,
    lastInteractionTs: 0,
    source: 'phrase',
  });

  it('matches open intentions on query keywords, ignoring resolved ones', () => {
    const all = [mk('reply to the recruiter'), mk('finish the resume'), mk('renew domain', 'done')];
    expect(matchIntentions(['recruiter'], all).map((i) => i.title)).toEqual(['reply to the recruiter']);
    expect(matchIntentions(['resume'], all)).toHaveLength(1);
    expect(matchIntentions(['domain'], all)).toHaveLength(0); // resolved → excluded
    expect(matchIntentions([], all)).toHaveLength(0);
  });
});
