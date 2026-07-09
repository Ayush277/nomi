import Dexie, { type EntityTable } from 'dexie';
import type { SealedBlob } from './crypto';
import type { NomiEventType } from './types';

/** Local store (ADR-3). Only what queries need stays plaintext (ids and
 * timestamps for range scans, event type); everything identifying — domains,
 * paths, signals — lives inside the AES-GCM `enc` blob. Volumes are small
 * (hundreds of rows/day), so post-decrypt filtering in memory is fine. */

export interface EventRow {
  id: string;
  ts: number;
  type: NomiEventType;
  enc: SealedBlob;
}

export interface SessionRow {
  id: string;
  startTs: number;
  enc: SealedBlob;
}

export interface RollupRow {
  /** YYYY-MM-DD local date. */
  id: string;
  enc: SealedBlob;
}

export const db = new Dexie('nomi') as Dexie & {
  events: EntityTable<EventRow, 'id'>;
  sessions: EntityTable<SessionRow, 'id'>;
  rollups: EntityTable<RollupRow, 'id'>;
};

db.version(1).stores({
  events: 'id, ts, type, domain',
  sessions: 'id, startTs, domain, category',
});

// v2: encrypted-at-rest rows. Pre-encryption dev data is cleared, not migrated.
db.version(2)
  .stores({
    events: 'id, ts, type',
    sessions: 'id, startTs',
    rollups: 'id',
  })
  .upgrade(async (tx) => {
    await tx.table('events').clear();
    await tx.table('sessions').clear();
  });
