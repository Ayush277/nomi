/** Long-Term Learning (V2 Upgrade 6) — Nomi slowly forms a picture of the
 * person: when they work, what they keep coming back to, their stack, their
 * distractions. The cardinal rule from the spec: "never learn from one event —
 * require repeated evidence." So every trait is gated on appearing across
 * several days before it's asserted at all. Pure derivations here; the async
 * wrapper reads the stores and saves into the profile. */

import { getProfile, saveProfile } from './profile';
import { getProjects, inferProject, type Project } from './projects';
import { allRollups, sessionsSince } from './store';
import type { DayRollup, LearnedProfile, VisitSession } from './types';

export const EMPTY_LEARNED: LearnedProfile = {
  peakHours: [],
  frequentSites: [],
  favoriteTech: null,
  mostActiveProject: null,
  typicalDistractions: [],
  daysObserved: 0,
  computedTs: 0,
};

/** Enough distinct days of data before we claim to know anything. */
export const LEARN_MIN_DAYS = 3;
/** A trait must recur on at least this many days to count as "learned". */
const RECUR_DAYS = 2;

const DOMAIN_TECH: Record<string, string> = {
  'docs.python.org': 'Python',
  'pypi.org': 'Python',
  'react.dev': 'React',
  'nextjs.org': 'Next.js',
  'developer.mozilla.org': 'JavaScript / web',
  'typescriptlang.org': 'TypeScript',
  'go.dev': 'Go',
  'rust-lang.org': 'Rust',
  'kotlinlang.org': 'Kotlin',
  'docs.oracle.com': 'Java',
};

function dayOf(ts: number): string {
  return new Date(ts).toDateString();
}

/** Count something per key, tracking on how many distinct days it appeared, and
 * return the top keys that recurred on >= RECUR_DAYS days. */
function topRecurring(
  rows: { key: string; weight: number; day: string }[],
  limit: number,
): string[] {
  const agg = new Map<string, { weight: number; days: Set<string> }>();
  for (const r of rows) {
    const a = agg.get(r.key) ?? { weight: 0, days: new Set<string>() };
    a.weight += r.weight;
    a.days.add(r.day);
    agg.set(r.key, a);
  }
  return [...agg.entries()]
    .filter(([, a]) => a.days.size >= RECUR_DAYS)
    .sort((x, y) => y[1].weight - x[1].weight)
    .slice(0, limit)
    .map(([k]) => k);
}

export function computeLearnedProfile(
  sessions: VisitSession[],
  rollups: DayRollup[],
  projects: Project[],
  now = Date.now(),
): LearnedProfile {
  const days = new Set(sessions.map((s) => dayOf(s.startTs)));
  const daysObserved = days.size;
  if (daysObserved < LEARN_MIN_DAYS) {
    return { ...EMPTY_LEARNED, daysObserved, computedTs: now };
  }

  // Peak hours: minutes per start-hour, recurring across days.
  const peakHours = topRecurring(
    sessions.map((s) => ({
      key: String(new Date(s.startTs).getHours()),
      weight: s.durationMs / 60000,
      day: dayOf(s.startTs),
    })),
    3,
  )
    .map(Number)
    .sort((a, b) => a - b);

  // Frequent sites: from rollups (longer memory), by total time, recurring.
  const frequentSites = topRecurring(
    rollups.flatMap((r) =>
      r.topDomains.map((d) => ({ key: d.domain, weight: d.totalMs, day: r.date })),
    ),
    5,
  );

  // Favourite tech: mapped domains, recurring.
  const favoriteTech =
    topRecurring(
      sessions
        .filter((s) => DOMAIN_TECH[s.domain])
        .map((s) => ({ key: DOMAIN_TECH[s.domain], weight: s.durationMs, day: dayOf(s.startTs) })),
      1,
    )[0] ?? null;

  // Most active project: time grouped by inferred project, recurring.
  const mostActiveProject =
    topRecurring(
      sessions
        .map((s) => ({ project: inferProject({ domain: s.domain, path: s.path }, projects), s }))
        .filter((x): x is { project: string; s: VisitSession } => x.project !== null)
        .map((x) => ({ key: x.project, weight: x.s.durationMs, day: dayOf(x.s.startTs) })),
      1,
    )[0] ?? null;

  // Typical distractions: social / entertainment time, recurring.
  const typicalDistractions = topRecurring(
    sessions
      .filter((s) => s.category === 'social' || s.category === 'entertainment')
      .map((s) => ({ key: s.domain, weight: s.durationMs, day: dayOf(s.startTs) })),
    3,
  );

  return {
    peakHours,
    frequentSites,
    favoriteTech,
    mostActiveProject,
    typicalDistractions,
    daysObserved,
    computedTs: now,
  };
}

/** Recompute learned traits from the last ~8 days of sessions + all rollups and
 * persist them onto the profile. Cheap enough to run daily; idempotent. */
export async function learnAndSave(now = Date.now()): Promise<LearnedProfile> {
  const [sessions, rollups, projects] = await Promise.all([
    sessionsSince(now - 8 * 86400000),
    allRollups(),
    getProjects(),
  ]);
  const learned = computeLearnedProfile(sessions, rollups, projects, now);
  const profile = await getProfile();
  await saveProfile({ ...profile, learned });
  return learned;
}

/** Render learned traits for the system prompt — only what we're confident of. */
export function describeLearned(l: LearnedProfile): string | null {
  if (l.daysObserved < LEARN_MIN_DAYS) return null;
  const bits: string[] = [];
  if (l.peakHours.length) bits.push(`most active around ${l.peakHours.map(hourLabel).join(', ')}`);
  if (l.favoriteTech) bits.push(`works a lot with ${l.favoriteTech}`);
  if (l.mostActiveProject) bits.push(`most active project lately is ${l.mostActiveProject}`);
  if (l.frequentSites.length) bits.push(`lives on ${l.frequentSites.slice(0, 3).join(', ')}`);
  if (l.typicalDistractions.length) bits.push(`tends to drift to ${l.typicalDistractions[0]}`);
  if (bits.length === 0) return null;
  return `What you've learned about them over ${l.daysObserved} days (patterns, not certainties): ${bits.join('; ')}.`;
}

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** What actually CHANGED between two learned snapshots — the "what changes
 * look in me" answer. Only speaks when both snapshots are confident, and only
 * about real differences; returns null when nothing meaningfully moved. */
export function describeLearnedChanges(prev: LearnedProfile, curr: LearnedProfile): string | null {
  if (prev.daysObserved < LEARN_MIN_DAYS || curr.daysObserved < LEARN_MIN_DAYS) return null;
  const bits: string[] = [];

  const prevHours = prev.peakHours.join(',');
  const currHours = curr.peakHours.join(',');
  if (prevHours && currHours && prevHours !== currHours) {
    bits.push(
      `your active hours shifted from around ${prev.peakHours.map(hourLabel).join(', ')} to around ${curr.peakHours.map(hourLabel).join(', ')}`,
    );
  }
  if (curr.favoriteTech && prev.favoriteTech && curr.favoriteTech !== prev.favoriteTech) {
    bits.push(`your main tech moved from ${prev.favoriteTech} to ${curr.favoriteTech}`);
  } else if (curr.favoriteTech && !prev.favoriteTech) {
    bits.push(`${curr.favoriteTech} became your main tech`);
  }
  if (
    curr.mostActiveProject &&
    prev.mostActiveProject &&
    curr.mostActiveProject !== prev.mostActiveProject
  ) {
    bits.push(`focus moved from "${prev.mostActiveProject}" to "${curr.mostActiveProject}"`);
  }
  const newSites = curr.frequentSites.filter((s) => !prev.frequentSites.includes(s)).slice(0, 2);
  if (prev.frequentSites.length && newSites.length) {
    bits.push(`${newSites.join(' and ')} entered your most-visited sites`);
  }
  const newDistraction = curr.typicalDistractions.find((d) => !prev.typicalDistractions.includes(d));
  const droppedDistraction = prev.typicalDistractions.find(
    (d) => !curr.typicalDistractions.includes(d),
  );
  if (newDistraction) bits.push(`${newDistraction} became a regular distraction`);
  if (droppedDistraction) bits.push(`you drift to ${droppedDistraction} less than before`);

  if (bits.length === 0) return null;
  return bits.join('; ') + '.';
}
