import { dateKey } from './time';
import type { DayRollup } from './types';

/** A day counts toward the streak when real work happened: ≥30 min of
 * coding/learning, or at least one accepted submission. */
export function isActiveDay(r: DayRollup): boolean {
  const focusMs = (r.byCategory.coding ?? 0) + (r.byCategory.learning ?? 0);
  return focusMs >= 30 * 60000 || r.accepted.length > 0;
}

/** Consecutive active days ending today (or yesterday, if today hasn't
 * become active yet — a streak isn't broken at 9 AM). Pure. */
export function computeStreak(rollups: DayRollup[], today: DayRollup): number {
  const byDate = new Map(rollups.map((r) => [r.date, r]));
  byDate.set(today.date, today);

  const cursor = new Date(`${today.date}T12:00:00`); // noon dodges DST edges
  if (!isActiveDay(today)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  for (;;) {
    const r = byDate.get(dateKey(cursor.getTime()));
    if (!r || !isActiveDay(r)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
