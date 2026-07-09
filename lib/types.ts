/** Event schema v1 — see docs/ARCHITECTURE.md ADR-3. */

export type SiteCategory =
  | 'coding'
  | 'learning'
  | 'social'
  | 'entertainment'
  | 'shopping'
  | 'career'
  | 'music'
  | 'other';

export type NomiEventType =
  | 'visit_start'
  | 'visit_end'
  | 'tab_switch'
  | 'idle_start'
  | 'idle_end'
  | 'site_signal';

export interface SiteSignal {
  adapter: string;
  kind: string;
  data: Record<string, string | number>;
}

export interface NomiEvent {
  id: string;
  ts: number;
  type: NomiEventType;
  /** Hostname only, e.g. "leetcode.com". */
  domain: string;
  /** Pathname only — query string and fragment are ALWAYS stripped (ADR-5). */
  path?: string;
  category: SiteCategory;
  /** visit_end only: milliseconds since the matching visit_start. */
  durationMs?: number;
  /** Site adapters only (ADR-5 Tier 2) — whitelisted fields, never page text. */
  signal?: SiteSignal;
}

/** A completed stretch of attention on one domain. Derived from visit events. */
export interface VisitSession {
  id: string;
  domain: string;
  path?: string;
  category: SiteCategory;
  startTs: number;
  endTs: number;
  durationMs: number;
}

/** The in-flight visit, persisted to chrome.storage.session so the MV3
 * worker can die and cold-start without losing it (ADR-2). */
export interface CurrentVisit {
  tabId: number;
  domain: string;
  path: string;
  category: SiteCategory;
  startTs: number;
}

// --- settings ---------------------------------------------------------------

export interface QuietHours {
  /** Local hours, 0–23. Window may wrap midnight (22 → 8). */
  startHour: number;
  endHour: number;
}

export interface NomiSettings {
  paused: boolean;
  exclusions: string[];
  /** null = no quiet hours. */
  quietHours: QuietHours | null;
  maxNudgesPerDay: number;
  /** Speak bubbles out loud (system voices, fully local). */
  voice: boolean;
  ollama: {
    enabled: boolean;
    model: string;
  };
}

export const DEFAULT_SETTINGS: NomiSettings = {
  paused: false,
  exclusions: [],
  quietHours: { startHour: 22, endHour: 8 },
  maxNudgesPerDay: 6,
  voice: true,
  ollama: { enabled: false, model: 'llama3.1:8b' },
};

/** Widget mood, set by the background, rendered by every tab's orb. */
export interface MoodState {
  kind: 'idle' | 'focus' | 'celebrate';
  /** celebrate only: when to fall back to idle. */
  until?: number;
  /** celebrate only: electric = normal win, flame = Hard / hot streak. */
  flavor?: 'electric' | 'flame';
}

/** Special effect attached to a bubble (water drop, stretch action, …). */
export type BubbleFx = 'water' | 'stretch';

// --- daily memory -----------------------------------------------------------

export interface DomainTotal {
  domain: string;
  category: SiteCategory;
  totalMs: number;
}

/** One day compacted (ADR-3): raw events expire after 7 days, rollups are the
 * long-term memory that survives. */
export interface DayRollup {
  /** Local date, YYYY-MM-DD. Also the primary key. */
  date: string;
  totalMs: number;
  byCategory: Partial<Record<SiteCategory, number>>;
  topDomains: DomainTotal[];
  firstTs: number | null;
  lastTs: number | null;
  tabSwitches: number;
  /** LeetCode wins captured by the adapter. */
  accepted: { slug: string; difficulty: string }[];
}

export interface ChatMessage {
  role: 'user' | 'nomi';
  text: string;
  ts: number;
}
