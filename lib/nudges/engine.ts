import type { Intention } from '../intents';
import { dateKey, inQuietHours } from '../time';
import type { CurrentVisit, NomiEvent, NomiSettings, VisitSession } from '../types';
import { assessWellbeing, deriveWellbeingInput } from '../wellbeing';
import { pickVariant } from './messages';

/** Rule engine over the event stream (roadmap Week 4). Pure functions —
 * no chrome imports — so every rule and guardrail is unit-testable.
 * Standing priority: when in doubt, Nomi says less. */

export interface NudgeState {
  lastFiredAt: Record<string, number>;
  lastAnyAt: number;
  countByDay: Record<string, number>;
  lastVariant: Record<string, number>;
  greetedOn?: string;
  hydrationAnchorTs?: number;
}

export const EMPTY_NUDGE_STATE: NudgeState = {
  lastFiredAt: {},
  lastAnyAt: 0,
  countByDay: {},
  lastVariant: {},
};

export interface NudgeContext {
  now: number;
  currentVisit: CurrentVisit | null;
  /** Decrypted events from the last few hours, ascending by ts. */
  recentEvents: NomiEvent[];
  todaySessions: VisitSession[];
  settings: NomiSettings;
  state: NudgeState;
  /** Open unfinished intentions (V2), highest-rank first. Optional so existing
   * callers/tests still typecheck. */
  openIntentions?: Intention[];
}

export interface Nudge {
  ruleId: string;
  text: string;
  state: NudgeState;
}

interface RuleHit {
  templateKey: string;
  slots?: Record<string, string>;
}

interface Rule {
  id: string;
  cooldownMs: number;
  /** Direct responses to something the user just did — allowed to bypass
   * quiet hours, the min-gap, and focus silence. Still capped per day. */
  celebratory?: boolean;
  /** Suppressed while the user is in deep focus (silence is a feature). */
  respectsFocus?: boolean;
  evaluate(ctx: NudgeContext): RuleHit | null;
}

const MIN_GAP_MS = 20 * 60000;
const FOCUS_THRESHOLD_MS = 25 * 60000;

function inFocus(ctx: NudgeContext): boolean {
  const v = ctx.currentVisit;
  return (
    v !== null &&
    ctx.now - v.startTs >= FOCUS_THRESHOLD_MS &&
    (v.category === 'coding' || v.category === 'learning')
  );
}

function activeMsSince(sessions: VisitSession[], sinceTs: number, ctx: NudgeContext): number {
  let ms = sessions.reduce(
    (acc, s) => acc + Math.max(0, s.endTs - Math.max(s.startTs, sinceTs)),
    0,
  );
  if (ctx.currentVisit) ms += Math.max(0, ctx.now - Math.max(ctx.currentVisit.startTs, sinceTs));
  return ms;
}

/** Ordered by priority: wins first, ambient observations last. */
const RULES: Rule[] = [
  {
    id: 'leetcode-win',
    cooldownMs: 5 * 60000,
    celebratory: true,
    evaluate(ctx) {
      const since = Math.max(ctx.state.lastFiredAt['leetcode-win'] ?? 0, ctx.now - 3 * 60000);
      const win = [...ctx.recentEvents]
        .reverse()
        .find(
          (e) =>
            e.type === 'site_signal' &&
            e.signal?.kind === 'submission_accepted' &&
            e.ts > since,
        );
      if (!win) return null;
      const hard = win.signal?.data.difficulty === 'Hard';
      return { templateKey: hard ? 'leetcode-win-hard' : 'leetcode-win' };
    },
  },
  {
    id: 'welcome-back',
    cooldownMs: 3 * 3600000,
    evaluate(ctx) {
      const last = ctx.recentEvents[ctx.recentEvents.length - 1];
      if (!last || last.type !== 'idle_end' || ctx.now - last.ts > 2 * 60000) return null;
      const idleStart = [...ctx.recentEvents].reverse().find((e) => e.type === 'idle_start');
      if (!idleStart || last.ts - idleStart.ts < 30 * 60000) return null;
      return { templateKey: 'welcome-back' };
    },
  },
  {
    id: 'focus-streak',
    cooldownMs: 2 * 3600000,
    evaluate(ctx) {
      const v = ctx.currentVisit;
      if (!v || ctx.now - v.startTs < 60 * 60000) return null;
      if (v.category !== 'coding' && v.category !== 'learning') return null;
      return { templateKey: 'focus-streak', slots: { domain: v.domain } };
    },
  },
  {
    // Wellbeing check-in (composite strain) — placed before break-time so the
    // caring, evidence-bearing message wins when several signals stack.
    id: 'wellbeing',
    cooldownMs: 3 * 3600000,
    evaluate(ctx) {
      const input = deriveWellbeingInput(ctx.now, ctx.todaySessions, ctx.recentEvents, ctx.currentVisit);
      const a = assessWellbeing(input);
      if (!a || a.strain !== 'strained') return null;
      return { templateKey: a.templateKey, slots: a.slots };
    },
  },
  {
    id: 'break-time',
    cooldownMs: 2.5 * 3600000,
    evaluate(ctx) {
      const v = ctx.currentVisit;
      if (!v || ctx.now - v.startTs < 105 * 60000) return null;
      return { templateKey: 'break-time' };
    },
  },
  {
    id: 'tab-storm',
    cooldownMs: 3600000,
    respectsFocus: true,
    evaluate(ctx) {
      const switches = ctx.recentEvents.filter(
        (e) => e.type === 'tab_switch' && e.ts > ctx.now - 5 * 60000,
      ).length;
      return switches >= 12 ? { templateKey: 'tab-storm' } : null;
    },
  },
  {
    // V2 Upgrade 10: an intention the user voiced but hasn't touched in hours.
    id: 'intention-ignored',
    cooldownMs: 8 * 3600000,
    respectsFocus: true,
    evaluate(ctx) {
      const stale = (ctx.openIntentions ?? []).find(
        (i) =>
          i.source === 'phrase' &&
          ctx.now - i.createdTs > 4 * 3600000 &&
          ctx.now - i.lastInteractionTs > 3 * 3600000,
      );
      return stale ? { templateKey: 'intention-ignored', slots: { what: stale.title } } : null;
    },
  },
  {
    // V2 Upgrade 10: a long stretch on a problem page with no accepted verdict.
    id: 'stuck',
    cooldownMs: 2 * 3600000,
    evaluate(ctx) {
      const v = ctx.currentVisit;
      if (!v) return null;
      if (!/leetcode\.com|geeksforgeeks\.org|hackerrank\.com|codeforces\.com/.test(v.domain)) return null;
      // Only a genuinely long single-problem stretch — past the focus-streak
      // ack — reads as "stuck", so this never interrupts calm focus.
      const dwell = ctx.now - v.startTs;
      if (dwell < 75 * 60000 || dwell > 150 * 60000) return null;
      const won = ctx.recentEvents.some(
        (e) =>
          e.type === 'site_signal' &&
          e.signal?.kind === 'submission_accepted' &&
          e.ts > v.startTs,
      );
      return won ? null : { templateKey: 'stuck', slots: { minutes: String(Math.round(dwell / 60000)) } };
    },
  },
  {
    id: 'hydration',
    cooldownMs: 2 * 3600000,
    respectsFocus: true,
    evaluate(ctx) {
      const anchor = ctx.state.hydrationAnchorTs ?? ctx.todaySessions[0]?.startTs;
      if (!anchor) return null;
      if (activeMsSince(ctx.todaySessions, anchor, ctx) < 2 * 3600000) return null;
      return { templateKey: 'hydration' };
    },
  },
  {
    id: 'greeting',
    cooldownMs: 12 * 3600000,
    evaluate(ctx) {
      if (ctx.state.greetedOn === dateKey(ctx.now)) return null;
      const anyActivity = ctx.currentVisit !== null || ctx.todaySessions.length > 0;
      return anyActivity ? { templateKey: 'greeting' } : null;
    },
  },
];

export function runNudgeEngine(ctx: NudgeContext): Nudge | null {
  const { settings, state, now } = ctx;
  if (settings.paused) return null;

  const today = dateKey(now);
  const firedToday = state.countByDay[today] ?? 0;
  if (firedToday >= settings.maxNudgesPerDay) return null;

  const quiet = inQuietHours(now, settings.quietHours);
  const gapBlocked = now - state.lastAnyAt < MIN_GAP_MS;
  const focused = inFocus(ctx);

  for (const rule of RULES) {
    if (!rule.celebratory && (quiet || gapBlocked)) continue;
    if (rule.respectsFocus && focused) continue;
    if (now - (state.lastFiredAt[rule.id] ?? 0) < rule.cooldownMs) continue;

    const hit = rule.evaluate(ctx);
    if (!hit) continue;

    const { text, variant } = pickVariant(hit.templateKey, state.lastVariant, hit.slots ?? {});
    if (!text) continue;

    const nextState: NudgeState = {
      ...state,
      lastFiredAt: { ...state.lastFiredAt, [rule.id]: now },
      lastAnyAt: now,
      countByDay: { [today]: firedToday + 1 }, // old days irrelevant; drop them
      lastVariant: { ...state.lastVariant, [hit.templateKey]: variant },
      greetedOn: rule.id === 'greeting' ? today : state.greetedOn,
      hydrationAnchorTs: rule.id === 'hydration' ? now : state.hydrationAnchorTs,
    };
    return { ruleId: rule.id, text, state: nextState };
  }
  return null;
}
