/** Buddy brain — the pure composition functions behind Nomi's companion
 * moves: the morning brief, open-loop resume, the Sunday weekly review with
 * goal check-in, and spaced resurfacing of forgotten bag links. All pure over
 * plain data (no chrome.*), wired up in the background worker and chat. */

import type { SavedLink } from './bag';
import type { DayRollup, LearnedProfile, VisitSession } from './types';

// ---------- shared formatting ----------

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

// ---------- open-loop resume ----------

export interface OpenLoop {
  domain: string;
  url: string;
  minutes: number;
  daysAgo: number;
}

/** The thing they were deep into recently but haven't touched today: the
 * longest coding/learning session from the last few days (≥15 min) on a
 * domain not yet visited today. Recency wins ties. */
export function findOpenLoop(
  recentSessions: VisitSession[],
  todayDomains: Set<string>,
  now = Date.now(),
): OpenLoop | null {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const candidates = recentSessions
    .filter(
      (s) =>
        s.startTs < dayStart.getTime() &&
        (s.category === 'coding' || s.category === 'learning') &&
        s.durationMs >= 15 * 60000 &&
        !todayDomains.has(s.domain),
    )
    .sort((a, b) => b.durationMs - a.durationMs || b.startTs - a.startTs);
  const best = candidates[0];
  if (!best) return null;
  return {
    domain: best.domain,
    url: `https://${best.domain}${best.path ?? ''}`,
    minutes: Math.round(best.durationMs / 60000),
    daysAgo: Math.max(1, Math.round((now - best.startTs) / 86400000)),
  };
}

export function describeOpenLoop(loop: OpenLoop): string {
  const when = loop.daysAgo === 1 ? 'yesterday' : `${loop.daysAgo} days ago`;
  return `You were ${loop.minutes} minutes deep in ${loop.domain} ${when} and haven't been back.`;
}

// ---------- morning brief ----------

export interface BriefInput {
  yesterday: DayRollup | null;
  /** Reminders that fire later today. */
  remindersToday: { what: string; at: number }[];
  loop: OpenLoop | null;
  name?: string;
}

/** One bubble, first browse of the day: where you left off, what's ahead.
 * Says nothing (returns null) when there's genuinely nothing to say —
 * an empty greeting every morning would train the user to ignore it. */
export function morningBrief(input: BriefInput, now = Date.now()): string | null {
  const bits: string[] = [];
  if (input.yesterday && input.yesterday.totalMs >= 10 * 60000) {
    const top = input.yesterday.topDomains[0];
    bits.push(
      `Yesterday: ${fmtMs(input.yesterday.totalMs)} online${top ? `, mostly ${top.domain}` : ''}.`,
    );
  }
  if (input.remindersToday.length) {
    const first = [...input.remindersToday].sort((a, b) => a.at - b.at)[0];
    const t = new Date(first.at);
    const hm = `${hourLabel(t.getHours())}${t.getMinutes() ? ':' + String(t.getMinutes()).padStart(2, '0') : ''}`;
    bits.push(
      `${input.remindersToday.length} reminder${input.remindersToday.length === 1 ? '' : 's'} today — first "${first.what}" around ${hm}.`,
    );
  }
  if (input.loop) {
    bits.push(`${describeOpenLoop(input.loop)} Say "what was I doing" to pick it back up.`);
  }
  if (bits.length === 0) return null;
  const hello = input.name ? `Morning, ${input.name}. ` : 'Morning. ';
  void now;
  return hello + bits.join(' ');
}

// ---------- weekly review + goal check-in ----------

export interface WeekReviewInput {
  /** Rollups from the last 7 days. */
  week: DayRollup[];
  /** Rollups from the 7 days before that. */
  prevWeek: DayRollup[];
  journal: { ts: number; text: string }[];
  goal?: string;
  learned?: LearnedProfile;
}

const GOAL_CATEGORIES = ['coding', 'learning'] as const;

function goalMs(rollups: DayRollup[]): number {
  return rollups.reduce(
    (sum, r) => sum + GOAL_CATEGORIES.reduce((s, c) => s + (r.byCategory[c] ?? 0), 0),
    0,
  );
}

/** The Sunday digest: honest totals, what moved toward the goal, and the
 * energy pattern worth protecting. Written into the living document and
 * summarised in one bubble. Null when the week had nothing observable. */
export function weeklyReview(input: WeekReviewInput): string | null {
  const total = input.week.reduce((s, r) => s + r.totalMs, 0);
  if (total < 30 * 60000) return null;

  const lines: string[] = [];
  const domains = new Map<string, number>();
  for (const r of input.week)
    for (const d of r.topDomains) domains.set(d.domain, (domains.get(d.domain) ?? 0) + d.totalMs);
  const top = [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  lines.push(
    `This week: ${fmtMs(total)} online across ${input.week.length} day${input.week.length === 1 ? '' : 's'}.` +
      (top.length ? ` Most time: ${top.map(([d, ms]) => `${d} (${fmtMs(ms)})`).join(', ')}.` : ''),
  );

  const wins = input.week.flatMap((r) => r.accepted);
  if (wins.length) lines.push(`${wins.length} problem${wins.length === 1 ? '' : 's'} solved.`);
  if (input.journal.length)
    lines.push(`You logged ${input.journal.length} thing${input.journal.length === 1 ? '' : 's'} — like "${input.journal[input.journal.length - 1].text}".`);

  const thisGoal = goalMs(input.week);
  const prevGoal = goalMs(input.prevWeek);
  if (input.goal && thisGoal >= 10 * 60000) {
    let trend = '';
    if (prevGoal >= 10 * 60000) {
      const pct = Math.round(((thisGoal - prevGoal) / prevGoal) * 100);
      trend =
        pct >= 5 ? ` — up ${pct}% on last week` : pct <= -5 ? ` — down ${Math.abs(pct)}% on last week` : ' — steady with last week';
    }
    lines.push(`Toward "${input.goal}": ${fmtMs(thisGoal)} of focused coding/learning${trend}.`);
  }

  if (input.learned && input.learned.peakHours.length) {
    lines.push(
      `Your best hours stay around ${input.learned.peakHours.map(hourLabel).join(', ')} — worth protecting.`,
    );
  }
  return lines.join(' ');
}

/** ISO-ish week key, e.g. "2026-W29" — one review per week, idempotent. */
export function weekKey(now = Date.now()): string {
  const d = new Date(now);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------- spaced resurfacing of the bag ----------

const RESURFACE_AFTER_MS = 3 * 86400000;

/** The one link worth bringing back today: saved 3+ days ago and never
 * resurfaced before. Oldest first — a true second memory returns things,
 * it doesn't just hoard them. One per day, the caller enforces the cadence. */
export function pickResurface(links: SavedLink[], now = Date.now()): SavedLink | null {
  const due = links
    .filter((l) => !l.resurfacedTs && now - l.ts >= RESURFACE_AFTER_MS)
    .sort((a, b) => a.ts - b.ts);
  return due[0] ?? null;
}

export function resurfaceText(link: SavedLink, now = Date.now()): string {
  const days = Math.max(3, Math.round((now - link.ts) / 86400000));
  return `Still in your bag from ${days} days ago: "${link.title}" (${link.domain}). Ask "what did I save" to open it — or "remove it" and I'll let it go.`;
}
