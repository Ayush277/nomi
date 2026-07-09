/** "Remind me to stretch in 20 minutes" — parsed here (pure), scheduled by
 * the background via chrome.alarms. Nomi never sets reminders on its own;
 * it only holds the ones you hand it. */

export interface ParsedReminder {
  what: string;
  delayMs: number;
}

const DEFAULT_DELAY_MS = 30 * 60000;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  second: 1000,
  m: 60000,
  min: 60000,
  minute: 60000,
  h: 3600000,
  hr: 3600000,
  hour: 3600000,
};

export function parseReminder(text: string): ParsedReminder | null {
  const m = text.match(/remind me(?: to| about| that)?\s+(.+)/i);
  if (!m) return null;
  let what = m[1].trim();

  let delayMs = DEFAULT_DELAY_MS;
  const timed = what.match(/^(.*?)\s+in\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b\.?$/i);
  if (timed) {
    what = timed[1].trim();
    let unit = timed[3].toLowerCase();
    if (unit.length > 1 && unit.endsWith('s')) unit = unit.slice(0, -1); // plural, not bare "s"
    delayMs = Number(timed[2]) * (UNIT_MS[unit] ?? 60000);
  }

  what = what.replace(/[.!?]+$/, '').trim();
  if (!what) return null;
  return { what, delayMs: Math.max(delayMs, 5000) };
}

export function confirmText(r: ParsedReminder): string {
  const mins = Math.round(r.delayMs / 60000);
  const when = mins < 1 ? 'in a few seconds' : mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
  return `Got it — I'll nudge you about "${r.what}" ${when}.`;
}
