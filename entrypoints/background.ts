import { validateSignal } from '../lib/adapters';
import { chatRespond } from '../lib/chat';
import { EMPTY_NUDGE_STATE, runNudgeEngine, type NudgeState } from '../lib/nudges/engine';
import { categorize } from '../lib/privacy';
import { buildRollup } from '../lib/rollup';
import { getSettings } from '../lib/settings';
import {
  eventsSince,
  getRollup,
  pruneOldData,
  saveRollup,
  sessionsBetween,
  sessionsSince,
} from '../lib/store';
import { todayLine, todayRollup } from '../lib/summary';
import { narrate } from '../lib/narrative';
import { dateKey, startOfDay } from '../lib/time';
import { getCurrentVisit, recordMarker, recordSignal, transitionTo } from '../lib/tracker';

/** Background worker (ADR-2): a pure event processor. No module-level state
 * that matters — every listener re-derives what it needs from storage, so a
 * cold start mid-day loses nothing. Keepalive hacks are banned. */

const RETENTION_ALARM = 'nomi:retention';
const NUDGE_ALARM = 'nomi:nudgeTick';
const EVENING_ALARM = 'nomi:evening';
const NUDGE_STATE_KEY = 'nomi:nudgeState';
const STATS_KEY = 'nomi:nudgeStats';
const IDLE_DETECTION_SECONDS = 90;
const EVENING_HOUR = 21;

async function activeTabUrl(): Promise<{ url: string | null; tabId: number | null }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return { url: tab?.url ?? null, tabId: tab?.id ?? null };
}

async function syncToActiveTab(): Promise<void> {
  const { url, tabId } = await activeTabUrl();
  await transitionTo(url, tabId);
}

async function showBubble(text: string): Promise<void> {
  await chrome.storage.session.set({
    'nomi:bubble': { id: crypto.randomUUID(), text },
  });
  const { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
  await chrome.storage.local.set({
    [STATS_KEY]: { shown: (stats?.shown ?? 0) + 1, dismissed: stats?.dismissed ?? 0 },
  });
}

/** Health check for "are we too chatty?" (PRD §8: <20% dismiss target). */
async function recordBubbleClosed(id: string, reason: 'dismissed' | 'expired'): Promise<void> {
  const { 'nomi:lastClosedBubble': lastId, [STATS_KEY]: stats } =
    await chrome.storage.local.get(['nomi:lastClosedBubble', STATS_KEY]);
  await chrome.storage.session.remove('nomi:bubble');
  if (lastId === id || reason !== 'dismissed') {
    await chrome.storage.local.set({ 'nomi:lastClosedBubble': id });
    return;
  }
  await chrome.storage.local.set({
    'nomi:lastClosedBubble': id,
    [STATS_KEY]: { shown: stats?.shown ?? 0, dismissed: (stats?.dismissed ?? 0) + 1 },
  });
}

async function nudgeTick(): Promise<void> {
  const now = Date.now();
  const settings = await getSettings();
  if (settings.paused) return;
  const stored = await chrome.storage.local.get(NUDGE_STATE_KEY);
  const state: NudgeState = { ...EMPTY_NUDGE_STATE, ...(stored[NUDGE_STATE_KEY] ?? {}) };

  const nudge = runNudgeEngine({
    now,
    currentVisit: await getCurrentVisit(),
    recentEvents: await eventsSince(now - 6 * 3600000),
    todaySessions: await sessionsSince(startOfDay(now)),
    settings,
    state,
  });
  if (!nudge) return;
  await chrome.storage.local.set({ [NUDGE_STATE_KEY]: nudge.state });
  await showBubble(nudge.text);
}

/** Compact past days into rollups (ADR-3) — idempotent, safe to re-run. */
async function compactPastDays(): Promise<void> {
  const now = Date.now();
  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const dayStart = startOfDay(now - daysBack * 86400000);
    const date = dateKey(dayStart);
    if (await getRollup(date)) continue;
    const sessions = await sessionsBetween(dayStart, dayStart + 86400000);
    if (sessions.length === 0) continue;
    const events = (await eventsSince(dayStart)).filter((e) => e.ts < dayStart + 86400000);
    await saveRollup(buildRollup(date, sessions, events));
  }
}

function nextEveningTime(): number {
  const d = new Date();
  d.setHours(EVENING_HOUR, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export default defineBackground(() => {
  // Let the widget's content script read nomi:bubble / widget state. This
  // only exposes OUR extension's session storage to OUR content scripts —
  // pages themselves can never touch it.
  void chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
  });

  // --- messages from widget / adapters -------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'nomi:today':
        void todayLine().then((text) => sendResponse({ text }));
        return true;
      case 'nomi:chat':
        void chatRespond(String(msg.text ?? ''), msg.history ?? []).then((text) =>
          sendResponse({ text }),
        );
        return true;
      case 'nomi:signal': {
        const signal = validateSignal(msg);
        if (signal) {
          void recordSignal(signal, 'leetcode.com', categorize('leetcode.com'))
            .then(nudgeTick) // celebrate immediately, not on the next tick
            .then(() => sendResponse({ ok: true }));
          return true;
        }
        sendResponse({ ok: false });
        return;
      }
      case 'nomi:bubbleClosed':
        void recordBubbleClosed(String(msg.id ?? ''), msg.reason === 'dismissed' ? 'dismissed' : 'expired');
        return;
    }
  });

  // --- attention tracking ---------------------------------------------------
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await recordMarker('tab_switch');
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await transitionTo(tab?.url ?? null, tabId);
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo.url || !tab.active) return;
    await transitionTo(changeInfo.url, tabId);
  });

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await transitionTo(null, null);
    } else {
      await syncToActiveTab();
    }
  });

  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.idle.onStateChanged.addListener(async (state) => {
    if (state === 'active') {
      await recordMarker('idle_end');
      await syncToActiveTab();
    } else {
      await recordMarker('idle_start');
      await transitionTo(null, null);
    }
  });

  // --- scheduled work ---------------------------------------------------------
  chrome.alarms.create(RETENTION_ALARM, { periodInMinutes: 60 * 24 });
  chrome.alarms.create(NUDGE_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(EVENING_ALARM, { when: nextEveningTime(), periodInMinutes: 60 * 24 });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    switch (alarm.name) {
      case NUDGE_ALARM:
        await nudgeTick();
        break;
      case RETENTION_ALARM:
        await compactPastDays();
        await pruneOldData();
        break;
      case EVENING_ALARM: {
        const settings = await getSettings();
        if (settings.paused) break;
        const rollup = await todayRollup();
        if (rollup.totalMs < 10 * 60000) break; // nothing worth narrating
        await saveRollup(rollup);
        await showBubble(narrate(rollup));
        break;
      }
    }
  });

  // --- lifecycle ---------------------------------------------------------------
  chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    await compactPastDays();
    await pruneOldData();
    await syncToActiveTab();
    if (reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
      await showBubble("Hey, I'm Nomi. I'll be right here.");
    }
  });

  chrome.runtime.onStartup.addListener(async () => {
    await compactPastDays();
    await syncToActiveTab();
  });
});
