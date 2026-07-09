import { describe, expect, it } from 'vitest';
import { buildRollup } from '../rollup';
import type { NomiEvent, VisitSession } from '../types';

const session = (over: Partial<VisitSession>): VisitSession => ({
  id: crypto.randomUUID(),
  domain: 'github.com',
  category: 'coding',
  startTs: 1000,
  endTs: 61000,
  durationMs: 60000,
  ...over,
});

describe('buildRollup', () => {
  it('aggregates totals, categories, and top domains', () => {
    const r = buildRollup(
      '2026-07-10',
      [
        session({ domain: 'leetcode.com', durationMs: 3600000, startTs: 100, endTs: 3600100 }),
        session({ domain: 'youtube.com', category: 'entertainment', durationMs: 600000 }),
        session({ domain: 'leetcode.com', durationMs: 1800000 }),
      ],
      [],
    );
    expect(r.totalMs).toBe(6000000);
    expect(r.byCategory.coding).toBe(5400000);
    expect(r.byCategory.entertainment).toBe(600000);
    expect(r.topDomains[0]).toMatchObject({ domain: 'leetcode.com', totalMs: 5400000 });
    expect(r.firstTs).toBe(100);
  });

  it('collects accepted submissions and tab switches from events', () => {
    const events: NomiEvent[] = [
      { id: '1', ts: 1, type: 'tab_switch', domain: '', category: 'other' },
      { id: '2', ts: 2, type: 'tab_switch', domain: '', category: 'other' },
      {
        id: '3',
        ts: 3,
        type: 'site_signal',
        domain: 'leetcode.com',
        category: 'coding',
        signal: {
          adapter: 'leetcode',
          kind: 'submission_accepted',
          data: { slug: 'two-sum', difficulty: 'Easy' },
        },
      },
    ];
    const r = buildRollup('2026-07-10', [], events);
    expect(r.tabSwitches).toBe(2);
    expect(r.accepted).toEqual([{ slug: 'two-sum', difficulty: 'Easy' }]);
  });

  it('handles an empty day', () => {
    const r = buildRollup('2026-07-10', [], []);
    expect(r.totalMs).toBe(0);
    expect(r.firstTs).toBeNull();
    expect(r.topDomains).toEqual([]);
  });
});
