/** Local-time helpers shared by rollups, nudges, and copy. */

export function startOfDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local date key, YYYY-MM-DD. */
export function dateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function weekdayName(ts: number): string {
  return new Date(ts).toLocaleDateString([], { weekday: 'long' });
}

/** True when `now` falls inside quiet hours; window may wrap midnight. */
export function inQuietHours(
  now: number,
  quiet: { startHour: number; endHour: number } | null,
): boolean {
  if (!quiet) return false;
  const hour = new Date(now).getHours();
  return quiet.startHour <= quiet.endHour
    ? hour >= quiet.startHour && hour < quiet.endHour
    : hour >= quiet.startHour || hour < quiet.endHour;
}
