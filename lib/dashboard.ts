import { getConnections, type Connections } from './connect';
import { getLinks, type SavedLink } from './bag';
import { getProfile, type NomiProfile } from './profile';
import { buildRollup } from './rollup';
import { allRollups, eventsSince, sessionsBetween } from './store';
import { computeStreak } from './streak';
import { todayRollup } from './summary';
import { startOfDay } from './time';
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

function buildTimeline(sessions: VisitSession[], events: NomiEvent[]): TimelineItem[] {
  const items: TimelineItem[] = sessions
    .filter((s) => s.durationMs >= 30000)
    .map((s) => ({
      ts: s.startTs,
      kind: 'visit' as const,
      label: s.domain,
      meta: s.category,
      durationMs: s.durationMs,
    }));
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

  return {
    profile: await getProfile(),
    streak,
    today,
    week,
    timeline: buildTimeline(todaySessions, todayEvents),
    solved,
    videos,
    links: (await getLinks()).slice().reverse(),
    connections: await getConnections(),
  };
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
