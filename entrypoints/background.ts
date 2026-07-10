import { ADAPTER_DOMAINS, validateSignal } from '../lib/adapters';
import { chatRespond, polishStory } from '../lib/chat';
import { geminiTranscribe } from '../lib/gemini';
import { EMPTY_NUDGE_STATE, runNudgeEngine, type NudgeState } from '../lib/nudges/engine';
import { categorize, observableUrl } from '../lib/privacy';
import { buildRollup } from '../lib/rollup';
import { getSettings } from '../lib/settings';
import {
  allRollups,
  eventsSince,
  getRollup,
  pruneOldData,
  saveRollup,
  sessionsBetween,
  sessionsSince,
} from '../lib/store';
import { computeStreak } from '../lib/streak';
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

/** Live "what's on screen" line for chat grounding — domain + page title
 * from the tabs API. Ephemeral: used in the prompt, never stored. */
async function screenContext(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return undefined;
  const clean = observableUrl(tab.url, (await getSettings()).exclusions);
  if (!clean) return undefined; // sensitive/excluded pages stay invisible, even to chat
  const title = (tab.title ?? '').slice(0, 120);
  return `${clean.domain}${clean.path}${title ? ` — "${title}"` : ''}`;
}

// ---- voice engine (offscreen document with local Whisper) -----------------

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
    justification: 'Local (on-device) Whisper voice input for the companion',
  });
}

/** A spoken sentence went through Whisper — run it through the same chat
 * brain and put both sides into the shared history so every widget sees it. */
async function handleVoiceText(text: string): Promise<void> {
  const t = text.trim();
  if (!t) {
    await showBubble("I didn't catch that — say it once more?");
    return;
  }
  const { 'nomi:chatHistory': history = [] } = await chrome.storage.session.get('nomi:chatHistory');
  const withUser = [...history, { role: 'user', text: t, ts: Date.now() }];
  await chrome.storage.session.set({ 'nomi:chatHistory': withUser });
  const reply = await chatRespond(t, history, await screenContext()).catch(
    () => 'Glitched on my side — say that again?',
  );
  await chrome.storage.session.set({
    'nomi:chatHistory': [...withUser, { role: 'nomi', text: reply, ts: Date.now() }],
  });
  await showBubble(reply);
}

async function syncToActiveTab(): Promise<void> {
  const { url, tabId } = await activeTabUrl();
  await transitionTo(url, tabId);
}

async function showBubble(text: string, fx?: string): Promise<void> {
  await chrome.storage.session.set({
    'nomi:bubble': { id: crypto.randomUUID(), text, fx },
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

/** Rules whose delivery comes with a physical action from the orb. */
const FX_BY_RULE: Record<string, string> = { hydration: 'water', 'break-time': 'stretch' };

async function nudgeTick(): Promise<void> {
  const now = Date.now();
  const settings = await getSettings();
  if (settings.paused) return;

  // A "focus with me" session: hold the mood, say nothing until the bell.
  const { 'nomi:focusSession': focusSession } = await chrome.storage.local.get('nomi:focusSession');
  if (focusSession && focusSession.until > now) {
    await chrome.storage.session.set({ 'nomi:mood': { kind: 'focus' } });
    return;
  }

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
  if (nudge) {
    await chrome.storage.local.set({ [NUDGE_STATE_KEY]: nudge.state });
    await showBubble(nudge.text, FX_BY_RULE[nudge.ruleId]);
  }

  // Streak note: once a day, mid-morning or later, when it's real.
  const today = dateKey(now);
  const { 'nomi:streakShownOn': streakShown } = await chrome.storage.local.get('nomi:streakShownOn');
  if (new Date(now).getHours() >= 10 && streakShown !== today) {
    await chrome.storage.local.set({ 'nomi:streakShownOn': today });
    const streak = computeStreak(await allRollups(), await todayRollup(now));
    if (streak >= 2) {
      await showBubble(`Day ${streak} in a row. Quiet consistency — that's how it compounds.`);
    }
  }

  // Ambient mood: focused when deep in a coding/learning stretch.
  const { 'nomi:mood': mood } = await chrome.storage.session.get('nomi:mood');
  if (mood?.kind === 'celebrate' && (mood.until ?? 0) > now) return;
  const visit = await getCurrentVisit();
  const focused =
    visit !== null &&
    now - visit.startTs >= 25 * 60000 &&
    (visit.category === 'coding' || visit.category === 'learning');
  const nextKind = focused ? 'focus' : 'idle';
  if (mood?.kind !== nextKind) {
    await chrome.storage.session.set({ 'nomi:mood': { kind: nextKind } });
  }
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
        void todayLine()
          .catch(() => "I'm here — just having trouble reading today's notes. Try again?")
          .then((text) => sendResponse({ text }));
        return true;
      case 'nomi:chat':
        // The widget must ALWAYS get an answer — a swallowed error here
        // reads as Nomi ignoring the user, which is the one unforgivable bug.
        void screenContext()
          .catch(() => undefined)
          .then((screen) => chatRespond(String(msg.text ?? ''), msg.history ?? [], screen))
          .catch((err) => {
            console.error('[nomi] chat error:', err);
            return `Something glitched on my side (${err instanceof Error ? err.message : 'unknown'}). Say that again?`;
          })
          .then((text) => sendResponse({ text }));
        return true;
      case 'nomi:listenOnce':
        void ensureOffscreen()
          .then(() => chrome.runtime.sendMessage({ type: 'nomi:offscreen:listenOnce' }))
          .catch(() => {
            void chrome.storage.session.set({
              'nomi:voiceStatus': { status: 'error', ts: Date.now() },
            });
          });
        return;
      case 'nomi:voiceText':
        void handleVoiceText(String(msg.text ?? ''));
        return;
      case 'nomi:voiceAudio':
        // Recorded clip from the offscreen mic → transcribe with the user's
        // Gemini key → straight into the normal chat flow.
        void (async () => {
          const settings = await getSettings();
          if (!settings.gemini.apiKey.trim()) {
            await chrome.storage.session.set({
              'nomi:voiceStatus': {
                status: 'error',
                message: 'Voice needs the Gemini key (Settings → Cloud AI).',
                ts: Date.now(),
              },
            });
            return;
          }
          try {
            const text = await geminiTranscribe({
              apiKey: settings.gemini.apiKey.trim(),
              model: settings.gemini.model,
              b64: String(msg.b64 ?? ''),
              mime: String(msg.mime ?? 'audio/webm'),
            });
            await chrome.storage.session.set({
              'nomi:voiceStatus': { status: 'idle', ts: Date.now() },
            });
            await handleVoiceText(text);
          } catch (err) {
            await chrome.storage.session.set({
              'nomi:voiceStatus': {
                status: 'error',
                message: `transcription failed (${err instanceof Error ? err.message : 'unknown'})`,
                ts: Date.now(),
              },
            });
          }
        })();
        return;
      case 'nomi:userSpeaking':
        // Barge-in: the human is talking — every tab's TTS goes quiet.
        void chrome.storage.session.set({ 'nomi:ttsStop': Date.now() });
        return;
      case 'nomi:voiceStatus':
        void chrome.storage.session.set({
          'nomi:voiceStatus': { status: msg.status, pct: msg.pct, message: msg.message, ts: Date.now() },
        });
        return;
      case 'nomi:signal': {
        const signal = validateSignal(msg);
        if (signal) {
          const domain = ADAPTER_DOMAINS[signal.adapter];
          const celebration =
            signal.kind === 'submission_accepted'
              ? (async () => {
                  // Hard problems and hot days earn the flame.
                  const wins = (await eventsSince(startOfDay())).filter(
                    (e) => e.type === 'site_signal' && e.signal?.kind === 'submission_accepted',
                  ).length;
                  const flame = signal.data.difficulty === 'Hard' || wins >= 2;
                  await chrome.storage.session.set({
                    'nomi:mood': {
                      kind: 'celebrate',
                      until: Date.now() + 18000,
                      flavor: flame ? 'flame' : 'electric',
                    },
                  });
                })()
              : Promise.resolve();
          void Promise.all([recordSignal(signal, domain, categorize(domain)), celebration])
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
      case 'nomi:cancelReminder': {
        const id = String(msg.id ?? '');
        void chrome.alarms.clear(`nomi:reminder:${id}`);
        void chrome.storage.local.get('nomi:reminders').then(({ 'nomi:reminders': rem }) => {
          if (rem && id in rem) {
            delete rem[id];
            return chrome.storage.local.set({ 'nomi:reminders': rem });
          }
        });
        return;
      }
      case 'nomi:endFocus':
        void chrome.alarms.clear('nomi:focusEnd');
        void chrome.storage.local.remove('nomi:focusSession');
        void chrome.storage.session.set({ 'nomi:mood': { kind: 'idle' } });
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

  // Talk to Nomi from anywhere (rebindable at chrome://extensions/shortcuts).
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'talk-to-nomi') {
      await chrome.storage.session.set({ 'nomi:openChat': { ts: Date.now(), voice: true } });
    }
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'nomi:focusEnd') {
      const { 'nomi:focusSession': fs } = await chrome.storage.local.get('nomi:focusSession');
      await chrome.storage.local.remove('nomi:focusSession');
      await chrome.storage.session.set({
        'nomi:mood': { kind: 'celebrate', until: Date.now() + 14000, flavor: 'electric' },
      });
      await showBubble(
        `Time — ${fs?.minutes ?? 'the'} minutes of heads-down, done. Shake it out?`,
        'stretch',
      );
      return;
    }
    if (alarm.name.startsWith('nomi:reminder:')) {
      const id = alarm.name.slice('nomi:reminder:'.length);
      const { 'nomi:reminders': reminders } = await chrome.storage.local.get('nomi:reminders');
      const entry = reminders?.[id];
      const what = typeof entry === 'string' ? entry : entry?.what;
      if (what) {
        delete reminders[id];
        await chrome.storage.local.set({ 'nomi:reminders': reminders });
        await showBubble(`You asked me to remind you: ${what}`);
      }
      return;
    }
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
        await showBubble(await polishStory(narrate(rollup)));
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
