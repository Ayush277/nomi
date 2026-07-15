import { ADAPTER_DOMAINS, validateSignal } from '../lib/adapters';
import { chatRespond, polishStory, proactiveComment } from '../lib/chat';
import {
  EMPTY_PROACTIVE_STATE,
  markReacted,
  parseReaction,
  proactivePrompt,
  shouldReact,
  type ProactiveState,
} from '../lib/proactive';
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
import { getOpenIntentions } from '../lib/intents';
import { describeLearned, describeLearnedChanges, EMPTY_LEARNED, learnAndSave } from '../lib/learning';
import { autodocChange, autodocDay, autodocMeta, autodocWeekly, dayDigest } from '../lib/autodoc';
import { getJournal } from '../lib/journal';
import { getProfile } from '../lib/profile';
import { findOpenLoop, morningBrief, pickResurface, resurfaceText, weeklyReview, weekKey } from '../lib/buddy';
import { getLinks, markResurfaced } from '../lib/bag';
import { geminiVision } from '../lib/gemini';
import { hasVisionSignal, parseVisionResult, visionPrompt } from '../lib/vision';
import { matchSiteReminder } from '../lib/smartreminders';
import { todayLine, todayRollup } from '../lib/summary';
import { narrate } from '../lib/narrative';
import { dateKey, startOfDay } from '../lib/time';
import { getCurrentVisit, recordMarker, recordSignal, transitionTo } from '../lib/tracker';
import type { NomiSettings } from '../lib/types';

/** Background worker (ADR-2): a pure event processor. No module-level state
 * that matters — every listener re-derives what it needs from storage, so a
 * cold start mid-day loses nothing. Keepalive hacks are banned. */

const RETENTION_ALARM = 'nomi:retention';
const NUDGE_ALARM = 'nomi:nudgeTick';
const EVENING_ALARM = 'nomi:evening';
const NUDGE_STATE_KEY = 'nomi:nudgeState';
const PROACTIVE_STATE_KEY = 'nomi:proactiveState';
const STATS_KEY = 'nomi:nudgeStats';
const IDLE_DETECTION_SECONDS = 90;
const EVENING_HOUR = 21;

async function activeTabUrl(): Promise<{ url: string | null; tabId: number | null }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return { url: tab?.url ?? null, tabId: tab?.id ?? null };
}

/** Live "what's on screen" for chat grounding — the actual visible page
 * text, pulled from the active tab's content script. Ephemeral: used in the
 * prompt, never stored. Sensitive/excluded/paused → nothing, so those pages
 * stay invisible even to chat. Returns a one-line label + the body text. */
async function screenContext(): Promise<{ label: string; text: string } | undefined> {
  const settings = await getSettings();
  if (settings.paused) return undefined;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url || tab.id === undefined) return undefined;
  const clean = observableUrl(tab.url, settings.exclusions);
  if (!clean) return undefined;

  const label = `${clean.domain}${clean.path}`;
  try {
    const snap = await chrome.tabs.sendMessage(tab.id, { type: 'nomi:snapshot' });
    const heading = snap?.heading || snap?.title || '';
    const labelWithTitle = heading ? `${clean.domain} — "${String(heading).slice(0, 120)}"` : label;
    return { label: labelWithTitle, text: String(snap?.text ?? '').slice(0, 2000) };
  } catch {
    // Content script not present (e.g. a store page) — fall back to the label.
    return { label: tab.title ? `${clean.domain} — "${tab.title.slice(0, 120)}"` : label, text: '' };
  }
}

/** Compose the screen string handed to the chat brain. */
function screenPrompt(screen: { label: string; text: string } | undefined): string | undefined {
  if (!screen) return undefined;
  return screen.text ? `${screen.label}\n\nVisible content:\n${screen.text}` : screen.label;
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
  const reply = await chatRespond(t, history, screenPrompt(await screenContext())).catch(
    () => 'Glitched on my side — say that again?',
  );
  await chrome.storage.session.set({
    'nomi:chatHistory': [...withUser, { role: 'nomi', text: reply, ts: Date.now() }],
  });
  // They ASKED by voice, so the answer speaks — and then listens once for a
  // follow-up, so a spoken exchange flows like a conversation. Silence ends it.
  await showBubble(reply, undefined, { speak: true, followUp: true });
}

async function syncToActiveTab(): Promise<void> {
  const { url, tabId } = await activeTabUrl();
  await transitionTo(url, tabId);
  await checkSiteReminders(url);
}

/** Context-triggered reminders (#13): the user asked to be reminded "when I
 * open X" — fire the moment they land on X. Uses the raw hostname only (no
 * recording), so it works even on sensitive sites like Gmail. */
async function checkSiteReminders(rawUrl: string | null): Promise<void> {
  if (!rawUrl) return;
  let host: string;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    host = u.hostname.toLowerCase();
  } catch {
    return;
  }
  const { 'nomi:siteReminders': reminders } = await chrome.storage.local.get('nomi:siteReminders');
  if (!reminders) return;
  const hit = matchSiteReminder(host, reminders, Date.now());
  if (!hit) return;
  delete reminders[hit.id];
  await chrome.storage.local.set({ 'nomi:siteReminders': reminders });
  await showBubble(`You're on ${hit.reminder.domain} — you wanted to: ${hit.reminder.what}`);
}

async function showBubble(
  text: string,
  fx?: string,
  voice?: { speak: boolean; followUp?: boolean },
): Promise<void> {
  await chrome.storage.session.set({
    'nomi:bubble': { id: crypto.randomUUID(), text, fx, speak: voice?.speak, followUp: voice?.followUp },
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

/** Vision Understanding (V2 Upgrade 4): opt-in. Capture the visible tab, turn
 * it into structured fields via the user's Gemini, store ONLY that structure,
 * and let the image go (it lives in one local and is never persisted). Gated by
 * pause / exclusions / sensitive sites / incognito, and by the user's interval.
 * Best-effort and non-blocking — any failure is silent. */
async function visionTick(settings: NomiSettings): Promise<void> {
  if (!settings.vision || !settings.gemini.apiKey.trim()) return;
  const now = Date.now();

  const { 'nomi:visionTs': last } = await chrome.storage.local.get('nomi:visionTs');
  const intervalMs = Math.max(60, settings.visionIntervalSec) * 1000;
  if (now - (last ?? 0) < intervalMs) return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.incognito || tab.windowId === undefined || !tab.url) return;
  if (!observableUrl(tab.url, settings.exclusions)) return; // sensitive/excluded/browser page

  // Commit the interval marker before the slow capture so overlapping ticks
  // don't double-fire.
  await chrome.storage.local.set({ 'nomi:visionTs': now });

  let dataUrl: string | undefined;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  } catch {
    return; // capture blocked (e.g. a restricted page) — skip quietly
  }
  if (!dataUrl) return;
  const b64 = dataUrl.replace(/^data:[^,]+,/, ''); // the only place the image exists

  try {
    const raw = await geminiVision({
      apiKey: settings.gemini.apiKey.trim(),
      model: settings.gemini.model,
      b64,
      mime: 'image/jpeg',
      prompt: visionPrompt(),
    });
    const snap = parseVisionResult(raw, now);
    if (hasVisionSignal(snap)) await chrome.storage.session.set({ 'nomi:vision': snap });
  } catch {
    // best-effort; no snapshot this round
  }
  // dataUrl / b64 fall out of scope here — nothing is stored.
}

/** Proactive mode: glance at the visible page and, on a changed context past
 * the cooldown, let the brain decide whether to say something unprompted.
 * Best-effort — any miss is silent. screenContext() already drops paused /
 * excluded / sensitive pages; incognito is skipped here for the same reason. */
async function proactiveTick(settings: NomiSettings): Promise<void> {
  if (!settings.proactive) return;
  const now = Date.now();

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.incognito) return;

  const screen = await screenContext();
  if (!screen) return;

  const stored = await chrome.storage.local.get(PROACTIVE_STATE_KEY);
  const state: ProactiveState = { ...EMPTY_PROACTIVE_STATE, ...(stored[PROACTIVE_STATE_KEY] ?? {}) };
  if (!shouldReact(state, now, screen)) return;

  // Commit the cooldown/context marker up front so a slow model call can't let
  // the next tick fire a second, overlapping reaction on the same page.
  await chrome.storage.local.set({ [PROACTIVE_STATE_KEY]: markReacted(now, screen.label) });

  const raw = await proactiveComment(screenPrompt(screen) ?? screen.label, proactivePrompt());
  const remark = raw ? parseReaction(raw) : null;
  if (remark) await showBubble(remark);
}

async function nudgeTick(): Promise<void> {
  const now = Date.now();
  const settings = await getSettings();
  if (settings.paused) return;

  // Vision capture runs on its own interval, silently and independently of
  // whether Nomi speaks this tick. Fire-and-forget so a slow model call never
  // delays the nudge logic below.
  void visionTick(settings);

  // A "focus with me" session: hold the mood, say nothing until the bell.
  const { 'nomi:focusSession': focusSession } = await chrome.storage.local.get('nomi:focusSession');
  if (focusSession && focusSession.until > now) {
    await chrome.storage.session.set({ 'nomi:mood': { kind: 'focus' } });
    return;
  }

  // Morning brief — once a day, first time we see them actually browsing
  // after 5am: yesterday's shape, today's reminders, the open loop to resume.
  const briefDay = dateKey(now);
  const { 'nomi:briefShownOn': briefShown } = await chrome.storage.local.get('nomi:briefShownOn');
  if (new Date(now).getHours() >= 5 && briefShown !== briefDay && (await getCurrentVisit())) {
    await chrome.storage.local.set({ 'nomi:briefShownOn': briefDay });
    const { 'nomi:reminders': rem } = await chrome.storage.local.get('nomi:reminders');
    const endOfDay = startOfDay(now) + 86400000;
    const remindersToday = Object.values((rem ?? {}) as Record<string, { what?: string; at?: number }>)
      .filter((r) => typeof r === 'object' && r.what && (r.at ?? 0) > now && (r.at ?? 0) < endOfDay)
      .map((r) => ({ what: r.what!, at: r.at! }));
    const recent = await sessionsSince(now - 4 * 86400000);
    const todayDomains = new Set(recent.filter((s) => s.startTs >= startOfDay(now)).map((s) => s.domain));
    const brief = morningBrief({
      yesterday: await getRollup(dateKey(now - 86400000)),
      remindersToday,
      loop: findOpenLoop(recent, todayDomains, now),
      name: (await getProfile()).name || undefined,
    });
    if (brief) {
      await showBubble(brief);
      return; // the brief owns this tick — no double bubbles
    }
  }

  const stored = await chrome.storage.local.get(NUDGE_STATE_KEY);
  const state: NudgeState = { ...EMPTY_NUDGE_STATE, ...(stored[NUDGE_STATE_KEY] ?? {}) };

  let spoke = false;
  const nudge = runNudgeEngine({
    now,
    currentVisit: await getCurrentVisit(),
    recentEvents: await eventsSince(now - 6 * 3600000),
    todaySessions: await sessionsSince(startOfDay(now)),
    settings,
    state,
    openIntentions: await getOpenIntentions(),
  });
  if (nudge) {
    await chrome.storage.local.set({ [NUDGE_STATE_KEY]: nudge.state });
    await showBubble(nudge.text, FX_BY_RULE[nudge.ruleId]);
    spoke = true;
  }

  // Streak note: once a day, mid-morning or later, when it's real.
  const today = dateKey(now);
  const { 'nomi:streakShownOn': streakShown } = await chrome.storage.local.get('nomi:streakShownOn');
  if (new Date(now).getHours() >= 10 && streakShown !== today) {
    await chrome.storage.local.set({ 'nomi:streakShownOn': today });
    const streak = computeStreak(await allRollups(), await todayRollup(now));
    if (streak >= 2) {
      await showBubble(`Day ${streak} in a row. Quiet consistency — that's how it compounds.`);
      spoke = true;
    }
  }

  // (The old "you keep returning to <url>" auto-intentions are gone — they
  // turned Meet links and chat threads into noise. Intentions are now only
  // what the user actually states.)

  // Proactive remark — only when the deterministic nudges stayed quiet, so we
  // never stack two bubbles on the user in one tick.
  if (!spoke) await proactiveTick(settings);

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
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg?.type) {
      case 'nomi:today':
        void todayLine()
          .catch(() => "I'm here — just having trouble reading today's notes. Try again?")
          .then((text) => sendResponse({ text }));
        return true;
      case 'nomi:stats':
        void (async () => {
          const rollup = await todayRollup();
          const streak = computeStreak(await allRollups(), rollup);
          sendResponse({
            streak,
            codingMs: rollup.byCategory.coding ?? 0,
            learningMs: rollup.byCategory.learning ?? 0,
            totalMs: rollup.totalMs,
            accepted: rollup.accepted.length,
          });
        })().catch(() => sendResponse(null));
        return true;
      case 'nomi:chat':
        // The widget must ALWAYS get an answer — a swallowed error here
        // reads as Nomi ignoring the user, which is the one unforgivable bug.
        void screenContext()
          .catch(() => undefined)
          .then((screen) => {
            const page =
              (msg.page as { url?: string; title?: string } | undefined) ??
              (sender.tab?.url ? { url: sender.tab.url, title: sender.tab.title } : undefined);
            return chatRespond(String(msg.text ?? ''), msg.history ?? [], screenPrompt(screen), page).then(
              (text) => ({ text, seeing: screen?.label }),
            );
          })
          .catch((err) => {
            console.error('[nomi] chat error:', err);
            return {
              text: `Something glitched on my side (${err instanceof Error ? err.message : 'unknown'}). Say that again?`,
              seeing: undefined,
            };
          })
          .then((res) => sendResponse(res));
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
              language: settings.language,
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
    await checkSiteReminders(changeInfo.url);
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
      case RETENTION_ALARM: {
        await compactPastDays();
        await pruneOldData();
        // Refresh the slowly-learned profile once a day — and record what
        // CHANGED versus the previous snapshot in the living document.
        const prevLearned = (await getProfile()).learned ?? EMPTY_LEARNED;
        const learned = await learnAndSave();
        const shift = describeLearnedChanges(prevLearned, learned);
        if (shift) await autodocChange(shift);
        const p = await getProfile();
        const profileBits: string[] = [];
        if (p.name) profileBits.push(`Name: ${p.name}.`);
        if (p.goal) profileBits.push(`Working toward: ${p.goal}.`);
        if (p.facts.length) profileBits.push('Facts: ' + p.facts.map((f) => f.text).join('; ') + '.');
        await autodocMeta(profileBits.length ? profileBits.join(' ') : null, describeLearned(learned));

        // Spaced resurfacing: one forgotten bag link per day, at most.
        const dueLink = pickResurface(await getLinks());
        if (dueLink) {
          await markResurfaced(dueLink.id);
          await showBubble(resurfaceText(dueLink));
        }

        // Sunday: the weekly review + goal check-in, once per week.
        const wk = weekKey();
        const { 'nomi:weeklyReviewOn': lastReview } = await chrome.storage.local.get('nomi:weeklyReviewOn');
        if (new Date().getDay() === 0 && lastReview !== wk) {
          const nowTs = Date.now();
          const rollups = await allRollups();
          const inRange = (r: { date: string }, from: number, to: number) => {
            const t = new Date(r.date + 'T12:00:00').getTime();
            return t >= from && t < to;
          };
          const review = weeklyReview({
            week: rollups.filter((r) => inRange(r, nowTs - 7 * 86400000, nowTs + 86400000)),
            prevWeek: rollups.filter((r) => inRange(r, nowTs - 14 * 86400000, nowTs - 7 * 86400000)),
            journal: (await getJournal()).filter((e) => e.ts >= nowTs - 7 * 86400000),
            goal: p.goal || undefined,
            learned,
          });
          if (review) {
            await chrome.storage.local.set({ 'nomi:weeklyReviewOn': wk });
            await autodocWeekly(wk, review);
            await showBubble(review.length > 220 ? review.slice(0, 217) + '…' : review);
          }
        }
        break;
      }
      case EVENING_ALARM: {
        const settings = await getSettings();
        if (settings.paused) break;
        const rollup = await todayRollup();
        if (rollup.totalMs < 10 * 60000) break; // nothing worth narrating
        await saveRollup(rollup);
        // The day goes into the living document before the bubble goes out.
        const dayStart = startOfDay(Date.now());
        const journalToday = (await getJournal()).filter((e) => e.ts >= dayStart).map((e) => e.text);
        await autodocDay(rollup.date, dayDigest(rollup, journalToday));
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
