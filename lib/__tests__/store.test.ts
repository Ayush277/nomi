import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Vault } from '../crypto';
import { db } from '../db';
import {
  addEvent,
  addSession,
  eventsSince,
  getRollup,
  pruneOldData,
  saveRollup,
  sessionsSince,
  setVaultForTests,
} from '../store';
import { buildRollup } from '../rollup';
import type { NomiEvent, VisitSession } from '../types';

const NOW = Date.now();

const event = (over: Partial<NomiEvent>): NomiEvent => ({
  id: crypto.randomUUID(),
  ts: NOW,
  type: 'visit_start',
  domain: 'github.com',
  category: 'coding',
  ...over,
});

const session = (over: Partial<VisitSession>): VisitSession => ({
  id: crypto.randomUUID(),
  domain: 'github.com',
  category: 'coding',
  startTs: NOW - 60000,
  endTs: NOW,
  durationMs: 60000,
  ...over,
});

beforeAll(async () => {
  setVaultForTests((await Vault.generate()).vault);
});

describe('encrypted store (integration over fake IndexedDB)', () => {
  it('round-trips events and sessions', async () => {
    await addEvent(event({ path: '/nomi/pull/1' }));
    await addSession(session({}));
    const [e] = await eventsSince(NOW - 1000);
    const [s] = await sessionsSince(NOW - 120000);
    expect(e.domain).toBe('github.com');
    expect(e.path).toBe('/nomi/pull/1');
    expect(s.durationMs).toBe(60000);
  });

  it('nothing identifying is readable in the raw rows', async () => {
    const rows = await db.events.toArray();
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain('github');
    expect(raw).not.toContain('/nomi/pull/1');
  });

  it('rollups round-trip', async () => {
    await saveRollup(buildRollup('2026-07-01', [session({})], []));
    const r = await getRollup('2026-07-01');
    expect(r?.topDomains[0]?.domain).toBe('github.com');
  });

  it('prunes raw data outside the 7-day window but keeps rollups', async () => {
    await addEvent(event({ id: 'old', ts: NOW - 8 * 86400000 }));
    await pruneOldData(NOW);
    expect(await db.events.get('old')).toBeUndefined();
    expect(await getRollup('2026-07-01')).not.toBeNull();
  });
});
