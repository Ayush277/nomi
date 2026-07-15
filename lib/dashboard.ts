import { getConnections, type Connections } from './connect';
import { getLinks, type SavedLink } from './bag';
import { getOpenIntentions } from './intents';
import { getJournal } from './journal';
import { getProfile, type NomiProfile } from './profile';
import { getProjects, inferProject, type Project } from './projects';
import { buildRollup } from './rollup';
import { allRollups, eventsSince, sessionsBetween } from './store';
import { computeStreak } from './streak';
import { todayRollup } from './summary';
import { getCurrentVisit } from './tracker';
import { startOfDay } from './time';
import { analyzeStudyDrift, type DriftReport } from './insights';
import type { DayRollup, NomiEvent, VisitSession } from './types';

/** Everything the local second-brain dashboard renders — all from on-device
 * data (Core Vision #6, kept local per the user's call). No network, no cloud. */

export interface TimelineItem {
  ts: number;
  kind: 'visit' | 'solved' | 'video';
  label: string;
  meta?: string;
  durationMs?: number;
}

export interface DashboardData {
  profile: NomiProfile;
  streak: number;
  today: DayRollup;
  week: DayRollup[];
  timeline: TimelineItem[];
  solved: { slug: string; difficulty: string; ts: number }[];
  videos: { title: string; ts: number }[];
  links: SavedLink[];
  connections: Connections;
  /** Every remembered day, for the calendar — date → its rollup. */
  history: Record<string, DayRollup>;
  /** Today's study-vs-drift read (YouTube during study: related or drifting). */
  drift: DriftReport | null;
}

function signalsToMemory(events: NomiEvent[]) {
  const solved: DashboardData['solved'] = [];
  const videos: DashboardData['videos'] = [];
  for (const e of events) {
    if (e.type !== 'site_signal' || !e.signal) continue;
    if (e.signal.kind === 'submission_accepted') {
      solved.push({
        slug: String(e.signal.data.slug ?? ''),
        difficulty: String(e.signal.data.difficulty ?? 'unknown'),
        ts: e.ts,
      });
    } else if (e.signal.kind === 'video_watch') {
      videos.push({ title: String(e.signal.data.title ?? ''), ts: e.ts });
    }
  }
  return { solved: solved.reverse(), videos: videos.reverse() };
}

function buildTimeline(
  sessions: VisitSession[],
  events: NomiEvent[],
  projects: Project[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = sessions
    .filter((s) => s.durationMs >= 30000)
    .map((s) => {
      // Label by the project when we can name it — "Nomi" instead of "github.com".
      const project = inferProject({ domain: s.domain, path: s.path }, projects);
      return {
        ts: s.startTs,
        kind: 'visit' as const,
        label: project ?? s.domain,
        meta: project ? `${s.category} · ${s.domain}` : s.category,
        durationMs: s.durationMs,
      };
    });
  for (const e of events) {
    if (e.type !== 'site_signal' || !e.signal) continue;
    if (e.signal.kind === 'submission_accepted') {
      items.push({
        ts: e.ts,
        kind: 'solved',
        label: String(e.signal.data.slug ?? '').replace(/-/g, ' '),
        meta: String(e.signal.data.difficulty ?? ''),
      });
    } else if (e.signal.kind === 'video_watch') {
      items.push({ ts: e.ts, kind: 'video', label: String(e.signal.data.title ?? '') });
    }
  }
  return items.sort((a, b) => b.ts - a.ts);
}

export async function loadDashboard(now = Date.now()): Promise<DashboardData> {
  const today = await todayRollup(now);
  const rollups = await allRollups();
  const streak = computeStreak(rollups, today);

  // Build the last 7 days (compute any missing from raw sessions), today last.
  const byDate = new Map(rollups.map((r) => [r.date, r]));
  const week: DayRollup[] = [];
  for (let d = 6; d >= 1; d--) {
    const dayStart = startOfDay(now - d * 86400000);
    const date = new Date(dayStart).toISOString().slice(0, 10);
    week.push(byDate.get(dateFromStart(dayStart)) ?? emptyDay(dateFromStart(dayStart)));
    void date;
  }
  week.push(today);

  const todaySessions = await sessionsBetween(startOfDay(now), now + 1);
  const todayEvents = (await eventsSince(startOfDay(now))).filter((e) => e.ts <= now);
  const allEvents = await eventsSince(0);
  const { solved, videos } = signalsToMemory(allEvents);
  const projects = await getProjects();

  const todayVideos = signalsToMemory(todayEvents).videos;
  const history: Record<string, DayRollup> = {};
  for (const r of rollups) history[r.date] = r;
  history[today.date] = today;

  return {
    profile: await getProfile(),
    streak,
    today,
    week,
    timeline: buildTimeline(todaySessions, todayEvents, projects),
    solved,
    videos,
    links: (await getLinks()).slice().reverse(),
    connections: await getConnections(),
    history,
    drift: analyzeStudyDrift(
      todaySessions,
      todayVideos,
      projects.map((p) => p.name),
      today.accepted.map((a) => a.slug),
    ),
  };
}

/** The internal "companion brief" (V2 Upgrade 11) — a compact live brain the
 * AI reads before every response, distinct from the user-facing DashboardData
 * above. Project / intention are placeholders until Phase B lands; everything
 * else is real today. */
export interface CompanionBrief {
  currentProject: string | null;
  currentGoal: string | null;
  currentIntention: string | null;
  focusScore: number;
  recentWins: string[];
  thingsWaiting: string[];
  suggestedNextAction: string | null;
}

/** 0–100 focus read from today's longest settled stretch and how much the
 * user churned between tabs. Pure so it stays unit-testable. */
export function computeFocusScore(
  longestFocusMs: number,
  activeMs: number,
  tabSwitches: number,
): number {
  if (activeMs < 60000) return 0;
  const focusPart = Math.min(1, longestFocusMs / (45 * 60000)) * 65;
  const activeHours = activeMs / 3600000;
  const churn = tabSwitches / Math.max(0.25, activeHours); // switches per active hour
  const churnPenalty = Math.min(35, churn * 1.2);
  return Math.max(0, Math.min(100, Math.round(35 + focusPart - churnPenalty)));
}

function longestFocusStretch(sessions: VisitSession[]): number {
  return sessions
    .filter((s) => s.category === 'coding' || s.category === 'learning')
    .reduce((max, s) => Math.max(max, s.durationMs), 0);
}

export async function loadCompanionBrief(now = Date.now()): Promise<CompanionBrief> {
  const profile = await getProfile();
  const today = await todayRollup(now);
  const sessions = await sessionsBetween(startOfDay(now), now + 1);
  const activeMs = sessions.reduce((sum, s) => sum + s.durationMs, 0);
  const focusScore = computeFocusScore(longestFocusStretch(sessions), activeMs, today.tabSwitches);

  const [visit, projects, openIntentions] = await Promise.all([
    getCurrentVisit(),
    getProjects(),
    getOpenIntentions(),
  ]);
  const currentProject = visit
    ? inferProject({ domain: visit.domain, path: visit.path }, projects)
    : null;

  const wins: string[] = [];
  for (const a of today.accepted.slice(-3)) {
    wins.push(`solved ${a.slug.replace(/-/g, ' ')}${a.difficulty !== 'unknown' ? ` (${a.difficulty})` : ''}`);
  }
  const journalToday = (await getJournal()).filter((e) => e.ts >= startOfDay(now));
  for (const e of journalToday.slice(-3)) wins.push(e.text);

  // Things waiting: unfinished intentions first (the V2 heart), then pending
  // timed reminders, then saved-for-later links.
  const waiting: string[] = [];
  for (const i of openIntentions.slice(0, 3)) waiting.push(i.title);
  const { 'nomi:reminders': reminders } = await chrome.storage.local.get('nomi:reminders');
  for (const r of Object.values((reminders ?? {}) as Record<string, { what?: string; at?: number }>)) {
    if (r?.what && (r.at ?? 0) > now) waiting.push(r.what);
  }
  const links = await getLinks();
  if (links.length) waiting.push(`${links.length} saved link${links.length === 1 ? '' : 's'} in your bag`);

  return {
    currentProject,
    currentGoal: profile.goal || null,
    currentIntention: openIntentions[0]?.title ?? null,
    focusScore,
    recentWins: wins.slice(-4),
    thingsWaiting: waiting.slice(0, 4),
    suggestedNextAction: suggestNextAction(profile.goal || null, waiting, focusScore),
  };
}

function suggestNextAction(
  goal: string | null,
  waiting: string[],
  focusScore: number,
): string | null {
  // Deliberately conservative — Phase C's reasoning engine will make this
  // smarter. For now: only surface something we can honestly stand behind.
  if (waiting.length > 0) return `follow up on: ${waiting[0]}`;
  if (goal && focusScore >= 40) return `keep going on your goal — ${goal}`;
  return null;
}

/** Render the brief into the compact block the system prompt carries. */
export function describeBrief(b: CompanionBrief): string | null {
  const lines: string[] = [];
  if (b.currentProject) lines.push(`Working on: ${b.currentProject}.`);
  if (b.currentGoal) lines.push(`Goal: ${b.currentGoal}.`);
  if (b.currentIntention) lines.push(`Top unfinished intention: ${b.currentIntention}.`);
  lines.push(`Focus score today: ${b.focusScore}/100.`);
  if (b.recentWins.length) lines.push(`Recent wins: ${b.recentWins.join('; ')}.`);
  if (b.thingsWaiting.length) lines.push(`Waiting / unfinished: ${b.thingsWaiting.join('; ')}.`);
  if (b.suggestedNextAction) lines.push(`A useful nudge could be to ${b.suggestedNextAction}.`);
  return lines.length ? `Companion brief (use it — reference these specifics, don't be generic):\n${lines.join(' ')}` : null;
}

function dateFromStart(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function emptyDay(date: string): DayRollup {
  return buildRollup(date, [], []);
}
