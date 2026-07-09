import { buildRollup } from './rollup';
import { eventsSince, sessionsSince } from './store';
import { getCurrentVisit } from './tracker';
import { dateKey, formatDuration, startOfDay } from './time';
import type { DayRollup, DomainTotal } from './types';

export type { DomainTotal } from './types';
export { formatDuration } from './time';

/** Today so far, as a rollup — includes the in-flight visit so the numbers
 * feel live, not "as of the last tab switch". */
export async function todayRollup(now = Date.now()): Promise<DayRollup> {
  const since = startOfDay(now);
  const sessions = await sessionsSince(since);
  const current = await getCurrentVisit();
  if (current && now - current.startTs >= 2000) {
    sessions.push({
      id: 'current',
      domain: current.domain,
      path: current.path,
      category: current.category,
      startTs: current.startTs,
      endTs: now,
      durationMs: now - current.startTs,
    });
  }
  return buildRollup(dateKey(now), sessions, await eventsSince(since));
}

export async function todayTotals(now = Date.now()): Promise<{
  totalMs: number;
  byDomain: DomainTotal[];
}> {
  const rollup = await todayRollup(now);
  return { totalMs: rollup.totalMs, byDomain: rollup.topDomains };
}

/** One companion-voiced line for the widget (voice rules in DESIGN.md). */
export async function todayLine(now = Date.now()): Promise<string> {
  const { totalMs, byDomain } = await todayTotals(now);
  if (totalMs < 60000) return "Just getting started today. I'm right here.";
  const top = byDomain[0];
  if (top && top.totalMs > totalMs * 0.5) {
    return `We've been at it about ${formatDuration(totalMs)} today — mostly ${top.domain}.`;
  }
  return `We've been at it about ${formatDuration(totalMs)} today.`;
}
