/** Wellbeing awareness — the companion noticing when the human is pushing too
 * hard, and checking in with care. Unlike the single-signal nudges (break-time,
 * tab-storm), this reads SEVERAL strain signals together — a long unbroken
 * stretch, a late hour, tab-thrash, a full day — and only speaks when they
 * stack into genuine strain. Then it names what it noticed (evidence) and
 * offers one gentle, specific, no-pressure suggestion. Never guilt, never a
 * command (DESIGN.md voice). Pure functions so the judgement is unit-testable;
 * the nudge engine calls it with derived inputs. */

import type { CurrentVisit, NomiEvent, VisitSession } from './types';

export interface WellbeingInput {
  now: number;
  hour: number; // local hour 0–23
  activeMsToday: number;
  /** How long they've been active without stepping away (0 if on a break now). */
  sinceBreakMs: number;
  tabSwitchesRecent: number; // last ~5 min
}

export type Strain = 'ok' | 'pushing' | 'strained';

export interface WellbeingAssessment {
  strain: Strain;
  reason: string; // human evidence, e.g. "over 2 hours without stepping away"
  templateKey: 'wellbeing-latenight' | 'wellbeing-break' | 'wellbeing-longday';
  slots: Record<string, string>;
}

const H = 3600000;
const MARATHON_MS = 110 * 60000; // ~2h without a break
const LONG_DAY_MS = 5 * H; // a long day (used in combination)
const HEAVY_DAY_MS = 6.5 * H; // a genuinely full day — enough on its own
const THRASH = 12; // tab switches in 5 min

function clockLabel(hour: number): string {
  if (hour === 0) return 'past midnight';
  if (hour < 5) return `${hour}am`;
  if (hour === 12) return 'midday';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/** Weigh the signals. Only a genuine stack ('strained') is worth interrupting
 * for; 'pushing' is noted but stays quiet. Pure. */
export function assessWellbeing(i: WellbeingInput): WellbeingAssessment | null {
  const lateNight = i.hour >= 23 || i.hour < 5;
  const marathon = i.sinceBreakMs >= MARATHON_MS;
  const longDay = i.activeMsToday >= LONG_DAY_MS;
  const heavyDay = i.activeMsToday >= HEAVY_DAY_MS;
  const thrash = i.tabSwitchesRecent >= THRASH;

  const signals = [marathon, longDay, thrash].filter(Boolean).length;
  const strained =
    (lateNight && (marathon || longDay)) ||
    (marathon && (longDay || thrash)) ||
    heavyDay || // a genuinely full day is worth a gentle "wrap up" on its own
    signals >= 3;
  if (!strained) {
    // Two signals without the amplifiers = pushing, but we stay silent.
    return signals >= 2 ? { strain: 'pushing', reason: '', templateKey: 'wellbeing-break', slots: {} } : null;
  }

  const hrs = (ms: number) => {
    const h = ms / H;
    return h >= 1.5 ? `${Math.round(h)} hours` : `${Math.round(ms / 60000)} minutes`;
  };

  // Pick the dominant concern → shapes the suggestion.
  if (lateNight) {
    return {
      strain: 'strained',
      reason: marathon ? `going ${hrs(i.sinceBreakMs)} straight` : 'still at it this late',
      templateKey: 'wellbeing-latenight',
      slots: { clock: clockLabel(i.hour), reason: marathon ? `${hrs(i.sinceBreakMs)} without a break` : 'a long day' },
    };
  }
  if ((heavyDay || longDay) && !marathon) {
    return {
      strain: 'strained',
      reason: `active most of the day (${hrs(i.activeMsToday)})`,
      templateKey: 'wellbeing-longday',
      slots: { reason: `about ${hrs(i.activeMsToday)} in today` },
    };
  }
  return {
    strain: 'strained',
    reason: marathon ? `${hrs(i.sinceBreakMs)} without stepping away` : 'a lot of switching around',
    templateKey: 'wellbeing-break',
    slots: {
      reason: marathon
        ? `${hrs(i.sinceBreakMs)} without a real break`
        : 'a lot of hopping between tabs',
    },
  };
}

/** Build the input from the raw event/session stream (pure). If they're idle
 * right now (on a break), strain is naturally zero. */
export function deriveWellbeingInput(
  now: number,
  sessions: VisitSession[],
  events: NomiEvent[],
  currentVisit: CurrentVisit | null,
): WellbeingInput {
  const hour = new Date(now).getHours();
  const activeMsToday =
    sessions.reduce((s, v) => s + v.durationMs, 0) +
    (currentVisit ? Math.max(0, now - currentVisit.startTs) : 0);

  const lastIdleStart = lastTs(events, 'idle_start');
  const lastIdleEnd = lastTs(events, 'idle_end');
  let sinceBreakMs: number;
  if (lastIdleStart && lastIdleStart > (lastIdleEnd ?? 0)) {
    sinceBreakMs = 0; // currently away — that IS the break
  } else {
    const activeSince = lastIdleEnd ?? sessions[0]?.startTs ?? now;
    sinceBreakMs = Math.max(0, now - activeSince);
  }

  const tabSwitchesRecent = events.filter(
    (e) => e.type === 'tab_switch' && e.ts > now - 5 * 60000,
  ).length;

  return { now, hour, activeMsToday, sinceBreakMs, tabSwitchesRecent };
}

function lastTs(events: NomiEvent[], type: NomiEvent['type']): number | null {
  let ts: number | null = null;
  for (const e of events) if (e.type === type && (ts === null || e.ts > ts)) ts = e.ts;
  return ts;
}
