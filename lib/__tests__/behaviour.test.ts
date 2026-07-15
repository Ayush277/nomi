/** Regression tests for the two behaviours that made Nomi feel dumb:
 * 1. "save this page" silently missing the bag (focus-dependent tab query) —
 *    now the widget sends its own page and the confirmation states the count.
 * 2. Answering the EXACT same canned line twice in a row when the user asks
 *    again — now the repeat guard re-answers from ground truth via the model.
 * Chrome + the DB layer are in-memory; the model is scripted. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const model = vi.hoisted(() => ({ script: [] as string[], calls: [] as { system?: string }[] }));
vi.mock('../gemini', () => ({
  geminiChat: vi.fn(async (opts: { system?: string }) => {
    model.calls.push(opts);
    return model.script.shift() ?? 'FINAL: (no more script)';
  }),
  geminiTranscribe: vi.fn(),
  geminiVision: vi.fn(),
  geminiTTS: vi.fn(),
  geminiAvailable: vi.fn(async () => true),
}));

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
    'nomi:profile': { name: 'Ayush', goal: '', facts: [], personality: 'friend', onboarded: true },
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local, session: bucket(), onChanged: { addListener() {} } },
    tabs: { query: async () => [] }, // NO focused tab — the old failure mode
    alarms: { create() {}, clear: async () => true },
  };
});

describe('bag: save + recall round trip', () => {
  it('saves from the page attached to the message, even with no queryable tab', async () => {
    const { chatRespond } = await import('../chat');
    const reply = await chatRespond('save this page', [], undefined, {
      url: 'https://react.dev/learn',
      title: 'Quick Start – React',
    });
    expect(reply).toContain("That's 1 in your bag now");
    expect(reply).toContain('react.dev');
  });

  it('recall finds what was just saved — never "empty" after a confirmed save', async () => {
    const { chatRespond } = await import('../chat');
    await chatRespond('save this page', [], undefined, {
      url: 'https://react.dev/learn',
      title: 'Quick Start – React',
    });
    await chatRespond('keep this page in my bag', [], undefined, {
      url: 'https://developer.mozilla.org/fetch',
      title: 'fetch() – MDN',
    });
    const reply = await chatRespond('what are the links i saved', []);
    expect(reply).toContain('Quick Start – React');
    expect(reply).toContain('fetch() – MDN');
  });

  it('empty-bag recall explains the save may have failed instead of a canned brush-off', async () => {
    const { chatRespond } = await import('../chat');
    const reply = await chatRespond('what are my saved links', []);
    expect(reply).toContain('nothing in it right now');
    expect(reply).toContain("didn't go through");
  });
});

describe('the never-repeat guard', () => {
  it('re-answers via the model with ground truth instead of repeating the same line', async () => {
    const { chatRespond } = await import('../chat');
    const first = await chatRespond('what are my saved links', []);
    model.script = ['Your bag really is empty — no save ever reached me. Try "save this page" on the page itself.'];
    const second = await chatRespond('what are my saved links', [
      { role: 'user', text: 'what are my saved links', ts: 1 },
      { role: 'nomi', text: first, ts: 2 },
    ]);
    expect(second).not.toBe(first);
    expect(second).toContain('bag really is empty');
    const system = model.calls[model.calls.length - 1]?.system ?? '';
    expect(system).toContain('GROUND TRUTH RIGHT NOW');
    expect(system).toContain('did NOT satisfy them');
  });

  it('with no model reachable, at least owns the repetition honestly', async () => {
    (globalThis as unknown as { chrome: { storage: { local: { set: (o: Record<string, unknown>) => Promise<void> } } } }).chrome.storage.local.set({
      'nomi:settings': {
        gemini: { enabled: false, apiKey: '', model: '' },
        ollama: { enabled: false, model: '' },
        freeChat: false,
        language: 'en',
      },
    });
    const { chatRespond } = await import('../chat');
    const first = await chatRespond('what are my saved links', []);
    const second = await chatRespond('what are my saved links', [
      { role: 'user', text: 'what are my saved links', ts: 1 },
      { role: 'nomi', text: first, ts: 2 },
    ]);
    expect(second).not.toBe(first);
    expect(second).toContain('I know I just said this');
  });
});
