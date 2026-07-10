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

/** Spoken-friendly duration — full words so TTS says "minutes", not "m". */
export function spokenDelay(delayMs: number): string {
  const mins = Math.round(delayMs / 60000);
  if (mins < 1) return 'in a few seconds';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.round(mins / 60);
  return `in ${h} hour${h === 1 ? '' : 's'}`;
}

export function confirmText(r: ParsedReminder): string {
  return `Got it — I'll nudge you about "${r.what}" ${spokenDelay(r.delayMs)}.`;
}
