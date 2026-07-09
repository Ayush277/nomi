import type { DayRollup, DomainTotal, NomiEvent, VisitSession } from './types';

/** Pure reducer: one day's sessions + events → the compact memory that
 * outlives the 7-day raw window (ADR-3). No chrome imports — unit-testable. */
export function buildRollup(
  date: string,
  sessions: VisitSession[],
  events: NomiEvent[],
): DayRollup {
  const byCategory: DayRollup['byCategory'] = {};
  const byDomain = new Map<string, DomainTotal>();
  let totalMs = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const s of sessions) {
    totalMs += s.durationMs;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + s.durationMs;
    const entry = byDomain.get(s.domain) ?? {
      domain: s.domain,
      category: s.category,
      totalMs: 0,
    };
    entry.totalMs += s.durationMs;
    byDomain.set(s.domain, entry);
    if (firstTs === null || s.startTs < firstTs) firstTs = s.startTs;
    if (lastTs === null || s.endTs > lastTs) lastTs = s.endTs;
  }

  const accepted: DayRollup['accepted'] = [];
  let tabSwitches = 0;
  for (const e of events) {
    if (e.type === 'tab_switch') tabSwitches++;
    if (e.type === 'site_signal' && e.signal?.kind === 'submission_accepted') {
      accepted.push({
        slug: String(e.signal.data.slug ?? ''),
        difficulty: String(e.signal.data.difficulty ?? 'unknown'),
      });
    }
  }

  return {
    date,
    totalMs,
    byCategory,
    topDomains: [...byDomain.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 10),
    firstTs,
    lastTs,
    tabSwitches,
    accepted,
  };
}
