/** Phase A integration smoke test. The unit tests cover the PURE derivations;
 * this one drives the real async assemblers (buildContextSnapshot,
 * loadCompanionBrief, liveContextBlock) through actual module code with only
 * the DB layer (store) and chrome.* replaced by in-memory fakes. It also
 * round-trips two pre-existing storage features (journal, profile) so a Phase A
 * change that broke them would fail here. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NomiEvent, VisitSession } from '../types';

// Replace the Dexie/IndexedDB layer with in-memory arrays the test controls.
const db = vi.hoisted(() => ({ sessions: [] as VisitSession[], events: [] as NomiEvent[] }));
vi.mock('../store', () => ({
  sessionsSince: async () => db.sessions,
  sessionsBetween: async () => db.sessions,
  eventsSince: async () => db.events,
  allRollups: async () => [],
  addEvent: async () => {},
  addSession: async () => {},
  getRollup: async () => undefined,
  saveRollup: async () => {},
  pruneOldData: async () => {},
}));

// Minimal in-memory chrome.storage / chrome.tabs.
function bucket(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...seed };
  return {
    _data: data,
    get: async (keys?: unknown) => {
      if (keys == null) return { ...data };
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, data[k as string]]));
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(keys as object)) out[k] = data[k] ?? (keys as never)[k];
      return out;
    },
    set: async (obj: Record<string, unknown>) => {
      Object.assign(data, obj);
    },
    remove: async (keys: string | string[]) => {
      for (const k of ([] as string[]).concat(keys)) delete data[k];
    },
  };
}

let local: ReturnType<typeof bucket>;
let session: ReturnType<typeof bucket>;

beforeEach(() => {
  db.sessions = [];
  db.events = [];
  local = bucket();
  session = bucket();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local,
      session,
      onChanged: { addListener() {} },
    },
    tabs: { query: async () => [{ id: 1 }, { id: 2 }, { id: 3 }] },
    alarms: { create() {}, clear: async () => true },
  };
});

const now = new Date('2026-07-11T14:00:00').getTime();

describe('Phase A — Context Engine assembly (real code path)', () => {
  it('builds a coherent snapshot from a live visit + tabs + events', async () => {
    const { buildContextSnapshot, describeContext } = await import('../context');
    await session.set({
      'nomi:currentVisit': {
        tabId: 1,
        domain: 'github.com',
        path: '/nomi/pull/42',
        category: 'coding',
        startTs: now - 42 * 60000,
      },
    });
    const events: NomiEvent[] = [
      { id: 'a', ts: now - 5 * 60000, type: 'tab_switch', domain: '', category: 'other' },
    ];
    const snap = await buildContextSnapshot(events, now);

    expect(snap.currentWebsite).toBe('github.com');
    expect(snap.currentCategory).toBe('coding');
    expect(snap.currentActivity).toBe('writing or reviewing code');
    expect(Math.round(snap.focusDurationMs / 60000)).toBe(42);
    expect(snap.openTabs).toBe(3);
    expect(snap.interruptionState).toBe('focused');

    const line = describeContext(snap)!;
    expect(line).toContain('github.com');
    expect(line).toContain('42 min');
    expect(line).toContain('3 tabs');
  });

  it('reports idle context with no visit and stays renderable', async () => {
    const { buildContextSnapshot, describeContext } = await import('../context');
    const snap = await buildContextSnapshot([], now);
    expect(snap.currentWebsite).toBeNull();
    expect(snap.interruptionState).toBe('idle');
    expect(describeContext(snap)).toBeNull(); // nothing worth saying
  });
});

describe('Phase A — Companion Brief assembly (real code path)', () => {
  it('produces a valid brief with goal, focus score and waiting items', async () => {
    const { loadCompanionBrief, describeBrief } = await import('../dashboard');
    await local.set({
      'nomi:profile': { name: 'Ayush', goal: 'land an internship', facts: [], personality: 'friend' },
      'nomi:reminders': { r1: { what: 'reply to the recruiter', at: now + 3600000 } },
    });
    db.sessions = [
      {
        id: 's1',
        domain: 'leetcode.com',
        category: 'coding',
        startTs: now - 40 * 60000,
        endTs: now - 5 * 60000,
        durationMs: 35 * 60000,
      },
    ];

    const brief = await loadCompanionBrief(now);
    expect(brief.currentGoal).toBe('land an internship');
    expect(typeof brief.focusScore).toBe('number');
    expect(brief.focusScore).toBeGreaterThan(0);
    expect(brief.focusScore).toBeLessThanOrEqual(100);
    expect(brief.thingsWaiting).toContain('reply to the recruiter');

    const rendered = describeBrief(brief)!;
    expect(rendered).toContain('land an internship');
    expect(rendered).toContain('Focus score');
  });
});

describe('Phase A — liveContextBlock wired for the prompt', () => {
  it('returns a single situated block without throwing', async () => {
    const { liveContextBlock } = await import('../chat');
    await session.set({
      'nomi:currentVisit': {
        tabId: 1,
        domain: 'leetcode.com',
        path: '/problems/two-sum',
        category: 'coding',
        startTs: now - 15 * 60000,
      },
    });
    const block = await liveContextBlock(now);
    expect(block).toBeTruthy();
    expect(block).toContain('leetcode.com');
    expect(block).toContain('Focus score');
  });
});

describe('Phase B — intentions & projects flow through the real code', () => {
  it('captures an intention and surfaces it in the brief + context', async () => {
    const { addIntention, parseIntent, getOpenIntentions } = await import('../intents');
    const { loadCompanionBrief } = await import('../dashboard');
    const { buildContextSnapshot } = await import('../context');

    const parsed = parseIntent('I need to finish the resume')!;
    await addIntention(parsed, { domain: 'overleaf.com' });

    const open = await getOpenIntentions();
    expect(open[0].title).toBe('finish the resume');

    const brief = await loadCompanionBrief(now);
    expect(brief.currentIntention).toBe('finish the resume');
    expect(brief.thingsWaiting).toContain('finish the resume');

    const snap = await buildContextSnapshot([], now);
    expect(snap.currentTask).toBe('finish the resume');
  });

  it('names the current project from a live GitHub visit', async () => {
    const { buildContextSnapshot, describeContext } = await import('../context');
    await session.set({
      'nomi:currentVisit': {
        tabId: 1,
        domain: 'github.com',
        path: '/ayush/nomi/pull/7',
        category: 'coding',
        startTs: now - 20 * 60000,
      },
    });
    const snap = await buildContextSnapshot([], now);
    expect(snap.currentProject).toBe('nomi'); // auto repo detection
    expect(describeContext(snap)).toContain('working on nomi');
  });
});

describe('Phase C — learning & retrieval through the real code', () => {
  it('learnAndSave persists a learned profile once there is enough evidence', async () => {
    const { learnAndSave } = await import('../learning');
    const { getProfile } = await import('../profile');
    const DAY = 86400000;
    // 3 distinct days on the same coding site → recurring evidence.
    db.sessions = [0, 1, 2].map((d) => ({
      id: `s${d}`,
      domain: 'leetcode.com',
      path: '/problems/x',
      category: 'coding',
      startTs: now - d * DAY,
      endTs: now - d * DAY + 30 * 60000,
      durationMs: 30 * 60000,
    }));
    const learned = await learnAndSave(now);
    expect(learned.daysObserved).toBe(3);

    const profile = await getProfile();
    expect(profile.learned?.daysObserved).toBe(3);
  });

  it('retrieveForPrompt surfaces an intention relevant to the question', async () => {
    const { addIntention, parseIntent } = await import('../intents');
    const { retrieveForPrompt } = await import('../chat');
    await addIntention(parseIntent('I should reply to the recruiter')!);
    const block = await retrieveForPrompt('did I ever deal with that recruiter email?', []);
    expect(block).toBeTruthy();
    expect(block).toContain('recruiter');
  });
});

describe('Phase D — vision snapshot flows into the prompt, image never stored', () => {
  it('a fresh vision snapshot in session appears in liveContextBlock', async () => {
    const { liveContextBlock } = await import('../chat');
    const { parseVisionResult } = await import('../vision');
    const snap = parseVisionResult(
      JSON.stringify({ application: 'GitHub', repository: 'ayush/nomi', errors: ['build failed'] }),
      now,
    );
    await session.set({ 'nomi:vision': snap });

    const block = await liveContextBlock(now);
    expect(block).toContain('GitHub');
    expect(block).toContain('build failed');

    // Contract: only the structured snapshot is in storage — no image bytes.
    const stored = JSON.stringify(session._data['nomi:vision']);
    expect(stored).not.toMatch(/data:image|base64|\/9j\//); // no data URL / JPEG marker
  });

  it('a stale vision snapshot is ignored', async () => {
    const { liveContextBlock } = await import('../chat');
    const { parseVisionResult } = await import('../vision');
    // Captured 10 minutes ago → past the 5-min freshness window.
    await session.set({
      'nomi:vision': parseVisionResult(JSON.stringify({ application: 'Figma' }), now - 10 * 60000),
    });
    const block = (await liveContextBlock(now)) ?? '';
    expect(block).not.toContain('Figma');
  });
});

describe('Reminder transcript replay — the "drink water" conversation, fixed', () => {
  it('parses "in one hour" and honours the spoken correction by retiming', async () => {
    const { chatRespond } = await import('../chat');

    // Turn 1 — exactly what the user said (voice transcript).
    const r1 = await chatRespond('Hey, remind me to drink water in one hour.', []);
    expect(r1).toContain('drink water');
    expect(r1).toContain('in 1 hour'); // NOT the bogus "in 30 minutes"

    // One reminder stored, correctly timed at +60 min.
    const { 'nomi:reminders': after1 } = (await local.get('nomi:reminders')) as {
      'nomi:reminders': Record<string, { what: string; at: number; createdTs: number }>;
    };
    const stored = Object.values(after1);
    expect(stored).toHaveLength(1);
    expect(stored[0].what).toBe('drink water');
    expect(Math.round((stored[0].at - stored[0].createdTs) / 60000)).toBe(60);

    // Turn 2 — the messy spoken correction, verbatim from the transcript.
    const r2 = await chatRespond(
      'No, no, remind me not in 1 hour 30 minutes, in 30 minutes, not',
      [],
    );
    expect(r2).toContain('Fixed');
    expect(r2).toContain('drink water'); // retimed the SAME reminder
    expect(r2).toContain('in 30 minutes');

    // Still exactly one reminder — no garbage "not in 1 hour…" duplicate.
    const { 'nomi:reminders': after2 } = (await local.get('nomi:reminders')) as {
      'nomi:reminders': Record<string, { what: string; at: number; createdTs: number }>;
    };
    const finals = Object.values(after2);
    expect(finals).toHaveLength(1);
    expect(finals[0].what).toBe('drink water');
    expect(Math.round((finals[0].at - Date.now()) / 60000)).toBe(30);
  });
});

describe('Skills pack — routed through the real chatRespond', () => {
  it('answers instant utilities offline (no model needed)', async () => {
    const { chatRespond } = await import('../chat');
    expect(await chatRespond("what's 15% of 2400", [])).toBe('360');
    expect(await chatRespond('what is 12 * 8', [])).toBe('96');
    expect(await chatRespond('5 km in miles', [])).toMatch(/3\.10/);
    expect(await chatRespond('3pm PST in IST', [])).toContain('IST');
  });

  it('read-aloud returns the visible page text for the widget to speak', async () => {
    const { chatRespond } = await import('../chat');
    const screen = "example.com — \"Two Sum\"\n\nVisible content:\nGiven an array, return two indices that sum to target.";
    const r = await chatRespond('read this to me', [], screen);
    expect(r).toContain('Given an array');
  });

  it('read-aloud is honest when the page has no text', async () => {
    const { chatRespond } = await import('../chat');
    const r = await chatRespond('read this page aloud', [], 'example.com'); // label only, no content
    expect(r).toMatch(/empty or restricted/i);
  });

  it('sets a timer via the reminder machinery', async () => {
    const { chatRespond } = await import('../chat');
    const r = await chatRespond('set a timer for 10 minutes', []);
    expect(r).toMatch(/Timer set/i);
    const { 'nomi:reminders': rem } = (await local.get('nomi:reminders')) as {
      'nomi:reminders': Record<string, { what: string; at: number }>;
    };
    const entry = Object.values(rem).find((x) => /timer/i.test(x.what));
    expect(entry).toBeTruthy();
    expect(Math.round((entry!.at - Date.now()) / 60000)).toBe(10);
  });
});

describe('Regression — pre-existing storage features still round-trip', () => {
  it('journal: logEntry then getJournal returns the entry', async () => {
    const { logEntry, getJournal } = await import('../journal');
    await logEntry('I applied to a job');
    const all = await getJournal();
    expect(all.map((e) => e.text)).toContain('I applied to a job');
  });

  it('profile: addFact then getProfile persists the fact', async () => {
    const { addFact, getProfile } = await import('../profile');
    await addFact('prepping for interviews');
    const p = await getProfile();
    expect(p.facts.map((f) => f.text)).toContain('prepping for interviews');
  });
});
