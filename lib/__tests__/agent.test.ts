import { describe, expect, it, vi } from 'vitest';
import { buildAgentSystem, parseAgentStep, runAgent, type AgentTool } from '../agent';

describe('parseAgentStep', () => {
  it('extracts a FINAL answer', () => {
    expect(parseAgentStep('FINAL: You solved it last Tuesday.').final).toBe('You solved it last Tuesday.');
    expect(parseAgentStep('THOUGHT: easy\nFINAL: Hi there').final).toBe('Hi there');
  });

  it('extracts an ACTION with its argument', () => {
    const s = parseAgentStep('THOUGHT: I should check memory\nACTION: recall(when did I study graphs)');
    expect(s.final).toBeUndefined();
    expect(s.action).toEqual({ name: 'recall', arg: 'when did I study graphs' });
    expect(s.thought).toContain('check memory');
  });

  it('treats a bare reply (no markers) as the final answer', () => {
    expect(parseAgentStep('Just a normal answer.').final).toBe('Just a normal answer.');
  });
});

describe('runAgent — reason → act → observe → answer', () => {
  const tool = (name: string, out: string, spy = vi.fn()): AgentTool => ({
    name,
    desc: name,
    run: async (arg) => {
      spy(arg);
      return out;
    },
  });

  it('calls a tool, feeds the observation back, then answers', async () => {
    const recallSpy = vi.fn();
    const tools = [tool('recall', 'leetcode.com last Tuesday ~7:40pm', recallSpy)];
    const script = [
      'THOUGHT: check memory\nACTION: recall(graphs)',
      'FINAL: You last did graphs on leetcode.com around 7:40pm Tuesday.',
    ];
    let i = 0;
    const seen: string[] = [];
    const ask = vi.fn(async (_sys: string, msgs: { role: string; content: string }[]) => {
      seen.push(msgs[msgs.length - 1].content);
      return script[i++];
    });

    const answer = await runAgent('when did I study graphs?', [], { ask, tools, base: 'You are Nomi.' });

    expect(recallSpy).toHaveBeenCalledWith('graphs');
    expect(answer).toContain('7:40pm');
    // The 2nd model call must have received the tool observation.
    expect(seen[1]).toContain('OBSERVATION: leetcode.com last Tuesday');
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('answers directly when no tool is needed (one call)', async () => {
    const ask = vi.fn(async () => 'FINAL: Hey! Right here.');
    const answer = await runAgent('hi', [], { ask, tools: [tool('recall', 'x')], base: 'b' });
    expect(answer).toBe('Hey! Right here.');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('handles an unknown tool gracefully and still finishes', async () => {
    const script = ['ACTION: teleport(home)', 'FINAL: Done my best.'];
    let i = 0;
    const seen: string[] = [];
    const ask = vi.fn(async (_s: string, msgs: { role: string; content: string }[]) => {
      seen.push(msgs[msgs.length - 1].content);
      return script[i++];
    });
    const answer = await runAgent('q', [], { ask, tools: [tool('recall', 'x')], base: 'b' });
    expect(seen[1]).toMatch(/No tool named "teleport"/);
    expect(answer).toBe('Done my best.');
  });

  it('forces a final answer when it runs out of steps', async () => {
    // Always tries to act → never says FINAL until forced.
    const ask = vi.fn(async (sys: string) =>
      /used all your tool steps/i.test(sys) ? 'FINAL: Best guess answer.' : 'ACTION: recall(x)',
    );
    const answer = await runAgent('q', [], { ask, tools: [tool('recall', 'obs')], base: 'b', maxSteps: 2 });
    expect(answer).toBe('Best guess answer.');
    // 2 loop steps + 1 forced call
    expect(ask).toHaveBeenCalledTimes(3);
  });
});

describe('buildAgentSystem', () => {
  it('lists the tools and the ACTION/FINAL protocol', () => {
    const sys = buildAgentSystem('You are Nomi.', [{ name: 'recall', desc: 'search memory', run: async () => '' }]);
    expect(sys).toContain('You are Nomi.');
    expect(sys).toContain('recall(arg): search memory');
    expect(sys).toContain('ACTION: tool_name(argument)');
    expect(sys).toContain('FINAL:');
  });
});
