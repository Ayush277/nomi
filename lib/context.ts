/** Context Engine (V2 Upgrade 1) — assembles the live "what is the user doing
 * right now" object that becomes an input to every AI response. Extends the
 * existing tracker (CurrentVisit) rather than replacing it: the visit gives us
 * site/page/focus-duration, and we add the derived signals on top.
 *
 * The derivations (activity / energy / interruption) are PURE so they stay
 * unit-testable (repo convention); the async assembler does the storage I/O,
 * the same shape as lib/dashboard.ts. Browser-scoped by honesty: an extension
 * sees tabs, not other OS apps, so there is no `currentApp`. currentProject /
 * currentTask are placeholders filled by Phase B (projects + intents). */

import { getOpenIntentions } from './intents';
import { getProfile } from './profile';
import { getProjects, inferProject } from './projects';
import { sessionsSince } from './store';
import { getCurrentVisit } from './tracker';
import { startOfDay } from './time';
import type { CurrentVisit, NomiEvent, SiteCategory } from './types';

export type EnergyLevel = 'fresh' | 'steady' | 'fatigued';
export type InterruptionState = 'focused' | 'switching' | 'idle';

export interface ContextSnapshot {
  currentWebsite: string | null;
  currentPage: string | null;
  currentCategory: SiteCategory | null;
  currentActivity: string | null;
  focusDurationMs: number;
  openTabs: number;
  currentGoal: string | null;
  currentProject: string | null;
  currentTask: string | null;
  energyEstimate: EnergyLevel;
  interruptionState: InterruptionState;
}

const ACTIVITY_BY_CATEGORY: Partial<Record<SiteCategory, string>> = {
  coding: 'writing or reviewing code',
  learning: 'reading or studying',
  career: 'job / internship hunting',
  social: 'on social media',
  entertainment: 'watching something',
  shopping: 'shopping',
  music: 'listening to music',
};

export function deriveActivity(category: SiteCategory | null): string | null {
  if (!category) return null;
  return ACTIVITY_BY_CATEGORY[category] ?? 'browsing';
}

/** Focused = settled on one page a while with little switching; switching =
 * churning between tabs; idle = nothing in focus. */
export function deriveInterruption(
  tabSwitchesLast10Min: number,
  focusDurationMs: number,
  hasVisit: boolean,
): InterruptionState {
  if (!hasVisit) return 'idle';
  if (tabSwitchesLast10Min >= 6) return 'switching';
  if (focusDurationMs >= 10 * 60000 && tabSwitchesLast10Min <= 2) return 'focused';
  return 'switching';
}

/** A rough, honest energy read from how long they've been going and the hour —
 * never claimed as precise, just enough to soften or hold back a nudge. */
export function deriveEnergy(activeMsToday: number, hour: number): EnergyLevel {
  const hours = activeMsToday / 3600000;
  if (hours >= 5 || hour >= 23 || hour < 5) return 'fatigued';
  if (hours >= 2) return 'steady';
  return 'fresh';
}

function countTabSwitches(events: NomiEvent[], sinceTs: number): number {
  return events.filter((e) => e.type === 'tab_switch' && e.ts >= sinceTs).length;
}

async function countOpenTabs(): Promise<number> {
  try {
    return (await chrome.tabs.query({})).length;
  } catch {
    return 0;
  }
}

/** Assemble the live context. `recentEvents` (last ~30 min, ascending) is
 * passed in by the caller so we don't double-read the event stream. */
export async function buildContextSnapshot(
  recentEvents: NomiEvent[],
  now = Date.now(),
): Promise<ContextSnapshot> {
  const visit: CurrentVisit | null = await getCurrentVisit();
  const profile = await getProfile();
  const openTabs = await countOpenTabs();
  const sessions = await sessionsSince(startOfDay(now));
  const [projects, openIntentions] = await Promise.all([getProjects(), getOpenIntentions()]);

  const focusDurationMs = visit ? Math.max(0, now - visit.startTs) : 0;
  const activeMsToday =
    sessions.reduce((sum, s) => sum + s.durationMs, 0) + focusDurationMs;
  const switches = countTabSwitches(recentEvents, now - 10 * 60000);

  const currentProject = visit
    ? inferProject({ domain: visit.domain, path: visit.path }, projects)
    : null;

  return {
    currentWebsite: visit?.domain ?? null,
    currentPage: visit?.path ?? null,
    currentCategory: visit?.category ?? null,
    currentActivity: deriveActivity(visit?.category ?? null),
    focusDurationMs,
    openTabs,
    currentGoal: profile.goal || null,
    currentProject,
    currentTask: openIntentions[0]?.title ?? null,
    energyEstimate: deriveEnergy(activeMsToday, new Date(now).getHours()),
    interruptionState: deriveInterruption(switches, focusDurationMs, visit !== null),
  };
}

/** Render the snapshot into the terse line the system prompt carries. Only the
 * live/derived signal — goal and memory are added elsewhere in the prompt. */
export function describeContext(c: ContextSnapshot): string | null {
  if (!c.currentWebsite && c.interruptionState === 'idle') return null;
  const mins = Math.round(c.focusDurationMs / 60000);
  const bits: string[] = [];
  if (c.currentProject) {
    // The whole point of Upgrade 3: name the work, not just the site.
    bits.push(mins >= 1 ? `working on ${c.currentProject} for ${mins} min` : `starting on ${c.currentProject}`);
    if (c.currentWebsite) bits.push(`via ${c.currentWebsite}`);
  } else if (c.currentWebsite) {
    const where = c.currentActivity ? `${c.currentWebsite} (${c.currentActivity})` : c.currentWebsite;
    bits.push(mins >= 1 ? `on ${where} for ${mins} min` : `just opened ${where}`);
  }
  if (c.openTabs > 0) bits.push(`${c.openTabs} tab${c.openTabs === 1 ? '' : 's'} open`);
  bits.push(
    c.interruptionState === 'focused'
      ? 'settled and focused'
      : c.interruptionState === 'switching'
        ? 'hopping between things'
        : 'stepped away',
  );
  bits.push(`energy seems ${c.energyEstimate}`);
  return `Right now: ${bits.join(', ')}.`;
}
