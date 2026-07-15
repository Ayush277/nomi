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
  /** Opt-in cloud chat. When enabled, chat messages leave the device — the
   * only feature that ever does, and it says so in Settings. */
  gemini: {
    enabled: boolean;
    apiKey: string;
    model: string;
  };
  /** Keyless free cloud chat fallback — used only when Gemini/Ollama can't answer. */
  freeChat: boolean;
  /** Proactive mode: Nomi reads the visible page on its tick and speaks up on
   * its own when something's worth a remark (needs a brain — Gemini/Ollama).
   * Still honors pause, exclusions, sensitive sites, and incognito. */
  proactive: boolean;
  /** Keep the orb fully present instead of tucking itself small at the edge
   * after a while. */
  alwaysVisible: boolean;
  /** Orb size multiplier (0.75 = small … 1.7 = extra large). */
  widgetScale: number;
  /** Orb colour theme. 'aurora' = default coral→violet. */
  orbTheme: 'aurora' | 'ocean' | 'ember' | 'forest' | 'mono';
  /** Conversation language. 'hinglish' = natural Hindi-English mix in Roman
   * script for both what Nomi hears (transcription) and says (replies + voice). */
  language: 'en' | 'hinglish';
  /** Vision Understanding (V2 Upgrade 4): periodically capture the visible tab,
   * extract structured info via a vision model, and DISCARD the image. Needs a
   * Gemini key. Off by default — the most sensitive capability. */
  vision: boolean;
  /** Seconds between vision captures (floored to ~60s by MV3 alarms). */
  visionIntervalSec: number;
}

export const DEFAULT_SETTINGS: NomiSettings = {
  paused: false,
  exclusions: [],
  quietHours: { startHour: 22, endHour: 8 },
  maxNudgesPerDay: 6,
  voice: true,
  ollama: { enabled: false, model: 'llama3.1:8b' },
  // WXT_GEMINI_KEY comes from the gitignored .env — dev convenience only.
  // A build meant for the Web Store must be made WITHOUT that file.
  gemini: {
    enabled: Boolean((import.meta as any).env?.WXT_GEMINI_KEY),
    apiKey: ((import.meta as any).env?.WXT_GEMINI_KEY as string) ?? '',
    // Free tier in mid-2026: older stable models have zero free quota;
    // the current preview models are what free keys can actually call.
    model: 'gemini-3.1-flash-lite-preview',
  },
  /** Keyless free cloud fallback (pollinations.ai) so chat never dead-ends. */
  freeChat: true,
  proactive: true,
  alwaysVisible: true,
  widgetScale: 1,
  orbTheme: 'aurora',
  language: 'en',
  vision: false,
  visionIntervalSec: 60,
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

/** Slowly-learned traits about the user (V2 Upgrade 6). Every field is
 * evidence-gated (recurs across days) before it's populated. */
export interface LearnedProfile {
  peakHours: number[];
  frequentSites: string[];
  favoriteTech: string | null;
  mostActiveProject: string | null;
  typicalDistractions: string[];
  daysObserved: number;
  computedTs: number;
}
