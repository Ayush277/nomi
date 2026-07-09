import { Vault } from './crypto';
import { db } from './db';
import type { DayRollup, NomiEvent, VisitSession } from './types';

/** Encrypted persistence API. Everything above this module works with plain
 * NomiEvent / VisitSession / DayRollup objects; sealing and opening happens
 * only here. */

const VAULT_KEY = 'nomi:vaultKey';

let vaultPromise: Promise<Vault> | null = null;

/** Tests inject a fresh vault so no chrome.storage is needed. */
export function setVaultForTests(vault: Vault): void {
  vaultPromise = Promise.resolve(vault);
}

function getVault(): Promise<Vault> {
  vaultPromise ??= (async () => {
    const stored = await chrome.storage.local.get(VAULT_KEY);
    if (stored[VAULT_KEY]) return Vault.fromJwk(stored[VAULT_KEY]);
    const { vault, jwk } = await Vault.generate();
    await chrome.storage.local.set({ [VAULT_KEY]: jwk });
    return vault;
  })();
  return vaultPromise;
}

// --- events -------------------------------------------------------------

export async function addEvent(event: NomiEvent): Promise<void> {
  const vault = await getVault();
  await db.events.add({
    id: event.id,
    ts: event.ts,
    type: event.type,
    enc: await vault.seal(event),
  });
}

export async function eventsSince(ts: number): Promise<NomiEvent[]> {
  const vault = await getVault();
  const rows = await db.events.where('ts').aboveOrEqual(ts).toArray();
  return Promise.all(rows.map((r) => vault.open<NomiEvent>(r.enc)));
}

// --- sessions -------------------------------------------------------------

export async function addSession(session: VisitSession): Promise<void> {
  const vault = await getVault();
  await db.sessions.add({
    id: session.id,
    startTs: session.startTs,
    enc: await vault.seal(session),
  });
}

export async function sessionsBetween(fromTs: number, toTs: number): Promise<VisitSession[]> {
  const vault = await getVault();
  const rows = await db.sessions.where('startTs').between(fromTs, toTs, true, false).toArray();
  const sessions = await Promise.all(rows.map((r) => vault.open<VisitSession>(r.enc)));
  return sessions.sort((a, b) => a.startTs - b.startTs);
}

export function sessionsSince(ts: number): Promise<VisitSession[]> {
  return sessionsBetween(ts, Infinity);
}

// --- rollups -------------------------------------------------------------

export async function saveRollup(rollup: DayRollup): Promise<void> {
  const vault = await getVault();
  await db.rollups.put({ id: rollup.date, enc: await vault.seal(rollup) });
}

export async function getRollup(date: string): Promise<DayRollup | null> {
  const vault = await getVault();
  const row = await db.rollups.get(date);
  return row ? vault.open<DayRollup>(row.enc) : null;
}

export async function allRollups(): Promise<DayRollup[]> {
  const vault = await getVault();
  const rows = await db.rollups.toArray();
  const rollups = await Promise.all(rows.map((r) => vault.open<DayRollup>(r.enc)));
  return rollups.sort((a, b) => a.date.localeCompare(b.date));
}

// --- lifecycle -------------------------------------------------------------

export const RETENTION_DAYS = 7;

/** Rolling window (free tier): raw events/sessions expire; rollups survive
 * as the long-term memory (ADR-3). */
export async function pruneOldData(now = Date.now()): Promise<void> {
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await db.events.where('ts').below(cutoff).delete();
  await db.sessions.where('startTs').below(cutoff).delete();
}

/** One-click wipe: everything, including the key. A new key is generated on
 * next write, so old exports can never be re-read either. */
export async function wipeAll(): Promise<void> {
  await Promise.all([db.events.clear(), db.sessions.clear(), db.rollups.clear()]);
  await chrome.storage.local.remove(VAULT_KEY);
  vaultPromise = null;
}

/** Decrypted export — the user's data belongs to the user. */
export async function exportAll(): Promise<{
  exportedAt: string;
  events: NomiEvent[];
  sessions: VisitSession[];
  rollups: DayRollup[];
}> {
  return {
    exportedAt: new Date().toISOString(),
    events: await eventsSince(0),
    sessions: await sessionsSince(0),
    rollups: await allRollups(),
  };
}
