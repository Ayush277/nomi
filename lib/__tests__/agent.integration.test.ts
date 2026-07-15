/** Proves the reasoning agent actually fires through the real chatRespond:
 * the model asks for a tool, the tool runs against (mocked) local data, the
 * observation is fed back, and the final answer references it. The model
 * provider (Gemini) is scripted; chrome + the DB layer are in-memory. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Script the model's ReAct turns.
const model = vi.hoisted(() => ({ script: [] as string[], calls: [] as unknown[][] }));
vi.mock('../gemini', () => ({
  geminiChat: vi.fn(async (opts: unknown) => {
    model.calls.push([opts]);
    return model.script.shift() ?? 'FINAL: (no more script)';
  }),
  geminiTranscribe: vi.fn(),
  geminiVision: vi.fn(),
  geminiAvailable: vi.fn(async () => true),
}));

// In-memory DB layer.
vi.mock('../store', () => ({
  sessionsSince: async () => [],
  sessionsBetween: async () => [],
  eventsSince: async () => [],
  allRollups: async () => [],
  addEvent: async () => {},
  addSession: async () => {},
  getRollup: async () => undefined,
  saveRollup: async () => {},
  pruneOldData: async () => {},
}));

function bucket(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...seed };
  return {
    get: async (keys?: unknown) => {
      if (keys == null) return { ...data };
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, data[k as string]]));
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(keys as object)) out[k] = data[k] ?? (keys as never)[k];
      return out;
    },
    set: async (o: Record<string, unknown>) => { Object.assign(data, o); },
    remove: async (k: string | string[]) => { for (const x of ([] as string[]).concat(k)) delete data[x]; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  model.script = [];
  model.calls = [];
  const local = bucket({
    'nomi:settings': {
      gemini: { enabled: true, apiKey: 'test-key', model: 'gemini-x' },
      ollama: { enabled: false, model: '' },
      freeChat: false,
      language: 'en',
    },
    'nomi:profile': { name: 'Ayush', goal: 'land an internship', facts: [], personality: 'friend', onboarded: true },
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local, session: bucket(), onChanged: { addListener() {} } },
    tabs: { query: async () => [{ id: 1 }] },
    alarms: { create() {}, clear: async () => true },
  };
});

describe('reasoning agent through chatRespond', () => {
  it('uses a tool, then answers grounded in what it found', async () => {
    const { chatRespond } = await import('../chat');
    // Turn 1: model decides to look up the profile. Turn 2: final answer.
    model.script = [
      'THOUGHT: I should ground this in their goal\nACTION: profile()',
      'FINAL: You\'re chasing land an internship — keep chipping away, you\'ve got this.',
    ];

    const answer = await chatRespond('give me a quick pep talk', []);

    expect(answer).toContain('internship');
    // Two model round-trips = it actually ran the loop (act → observe → answer).
    const { geminiChat } = (await import('../gemini')) as unknown as { geminiChat: { mock: { calls: unknown[][] } } };
    expect(geminiChat.mock.calls.length).toBe(2);
    // The 2nd call must have carried the tool OBSERVATION (the goal).
    const secondCall = geminiChat.mock.calls[1][0] as { messages: { content: string }[] };
    const carried = secondCall.messages.map((m) => m.content).join('\n');
    expect(carried).toMatch(/OBSERVATION:.*land an internship/s);
  });

  it('answers directly (single round-trip) when no tool is needed', async () => {
    const { chatRespond } = await import('../chat');
    model.script = ['FINAL: Anytime — I\'m right here.'];
    const answer = await chatRespond('you are great', []);
    expect(answer).toContain('right here');
    const { geminiChat } = (await import('../gemini')) as unknown as { geminiChat: { mock: { calls: unknown[][] } } };
    expect(geminiChat.mock.calls.length).toBe(1);
  });
});
