/** "Remind me to stretch in 20 minutes" — parsed here (pure), scheduled by
 * the background via chrome.alarms. Nomi never sets reminders on its own;
 * it only holds the ones you hand it.
 *
 * Speech-friendly: understands word numbers ("in one hour", "in an hour",
 * "half an hour"), compound durations ("1 hour 30 minutes"), and when someone
 * corrects themselves mid-sentence ("not in 1 hour, in 30 minutes") the LAST
 * duration wins — that's how spoken corrections work. */

export interface ParsedReminder {
  what: string;
  delayMs: number;
  /** True when no time was given and we fell back to 30 minutes — the confirm
   * message says so honestly instead of pretending the user chose it. */
  defaulted?: boolean;
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
  day: 86400000,
  week: 604800000,
  wk: 604800000,
};

/** Absolute times ("at 11am", "on the 11th", "tomorrow", "July") and clock
 * ranges that this relative-only parser can't honour. When one of these is
 * present we must NOT silently invent a 30-minute timer — better to hand back
 * null so the caller can be honest about what it couldn't understand. */
const ABSOLUTE_TIME =
  /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\bat\s+\d|\b\d{1,2}(?:st|nd|rd|th)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:tomorrow|tonight|midnight|noon|o'?clock)\b/i;

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90,
};

/** Turn spoken duration phrasings into the canonical "<digits> <unit>" form so
 * one digit-based regex can extract them all. Pure text→text. */
export function normalizeDurations(text: string): string {
  let s = text
    .replace(/\bhalf an hour\b/gi, '30 minutes')
    .replace(/\ban? hour and a half\b/gi, '90 minutes')
    .replace(/\ba couple(?: of)?\s+/gi, '2 ')
    .replace(/\ban?\s+(hour|hr|minute|min|second|sec|day|week)\b/gi, '1 $1');
  // Word numbers, only when a time unit follows ("one hour", never "someone").
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty(?:-five)?|fifty|sixty|ninety)\s+(?=(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?)\b)/gi,
    (_, w: string) => `${WORD_NUMBERS[w.toLowerCase()] ?? w} `,
  );
  // Compound: "1 hour 30 minutes" / "1 hour and 30 minutes" → total minutes.
  s = s.replace(
    /\b(\d+)\s*(?:hours?|hrs?|h)\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/gi,
    (_, h: string, m: string) => `${Number(h) * 60 + Number(m)} minutes`,
  );
  // Decimal hours: "1.5 hours" → 90 minutes.
  s = s.replace(/\b(\d+)\.(\d+)\s*(?:hours?|hrs?|h)\b/gi, (_, h: string, f: string) =>
    `${Math.round((Number(h) + Number(`0.${f}`)) * 60)} minutes`,
  );
  return s;
}

/** Fresh regex each call (global regexes carry lastIndex state). */
const durationRe = () =>
  /\b(?:in|after)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|weeks?|wks?)\b\.?/gi;

function msOf(num: string, rawUnit: string): number {
  let unit = rawUnit.toLowerCase();
  if (unit.length > 1 && unit.endsWith('s')) unit = unit.slice(0, -1); // plural, not bare "s"
  return Number(num) * (UNIT_MS[unit] ?? 60000);
}

/** The relative delay named anywhere in the text, or null. When several are
 * named ("not in 1 hour, in 30 minutes") the last one wins — corrections come
 * last in speech. Used both for parsing and for retiming an existing reminder. */
export function extractDelay(text: string): number | null {
  const s = normalizeDurations(text);
  const re = durationRe();
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) last = m;
  if (!last) return null;
  return Math.max(msOf(last[1], last[2]), 5000);
}

export function parseReminder(text: string): ParsedReminder | null {
  const m = text.match(/remind me(?: to| about| that)?\s+(.+)/i);
  if (!m) return null;
  let what = normalizeDurations(m[1].trim());

  const re = durationRe();
  let last: RegExpExecArray | null = null;
  let hit: RegExpExecArray | null = null;
  while ((hit = re.exec(what))) last = hit;

  let delayMs = DEFAULT_DELAY_MS;
  const defaulted = last === null;
  if (last) {
    delayMs = msOf(last[1], last[2]);
    // Every duration fragment comes out of the task text — including the
    // discarded earlier ones from a self-correction.
    what = what.replace(durationRe(), ' ');
  }

  what = what
    .replace(/^\s*(?:to|about|that)\b\s*/i, '') // leading connective left behind by "remind me in X to …"
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+(?:no+|not|nah)[,.!?\s]*$/i, '') // trailing spoken negation
    .replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, '')
    .trim();

  // A husk of pure negation/filler ("not , , not") isn't a task — the caller
  // treats that as a correction to an existing reminder, not a new one.
  const husk = what.replace(/\b(no+|not|nah|and|but|then|ok(?:ay)?|please|pls)\b/gi, '').replace(/[^a-z0-9]/gi, '');
  if (!husk) return null;

  // We only understand relative delays. If the phrase names an absolute time
  // we couldn't parse, refuse rather than fabricate a wrong 30-minute timer.
  if (defaulted && ABSOLUTE_TIME.test(what)) return null;

  what = what.replace(/[.!?]+$/, '').trim();
  if (defaulted) return { what, delayMs, defaulted: true };
  return { what, delayMs: Math.max(delayMs, 5000) };
}

/** Spoken-friendly duration — full words so TTS says "minutes", not "m". */
export function spokenDelay(delayMs: number): string {
  const mins = Math.round(delayMs / 60000);
  if (mins < 1) return 'in a few seconds';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.round(mins / 60);
  if (h < 24) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

export function confirmText(r: ParsedReminder): string {
  if (r.defaulted) {
    return `Got it — "${r.what}". You didn't say when, so I'll nudge you in 30 minutes — say a time like "in 10 minutes" to change it.`;
  }
  return `Got it — I'll nudge you about "${r.what}" ${spokenDelay(r.delayMs)}.`;
}
