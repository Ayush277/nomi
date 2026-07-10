import { getLinks, isRecallLinks, isSaveLink, saveLink, searchLinks } from './bag';
import { freeChat } from './freechat';
import { geminiChat } from './gemini';
import { getDocs, searchDocs } from './docs';
import { countEntries, getJournal, isCountQuery, logEntry, parseLog } from './journal';
import { isMemoryQuery, searchMemory } from './memory';
import { observableUrl } from './privacy';
import { confirmSiteReminder, parseSiteReminder } from './smartreminders';
import { narrate } from './narrative';
import { ollamaChat } from './ollama';
import { buildSystemPrompt, PERSONALITIES } from './persona';
import { addFact, getProfile, parseName, parseRemember, removeFact, saveProfile } from './profile';
import { confirmText, parseReminder } from './reminders';
import { getSettings } from './settings';
import { allRollups, eventsSince, sessionsSince } from './store';
import { todayLine, todayRollup } from './summary';
import type { ChatMessage } from './types';

/** Background-side chat brain (ADR-4): intent handlers work with no LLM;
 * freeform conversation upgrades in when the user has Ollama running. */

const NO_LLM_FALLBACK =
  'For open conversation, connect a brain in Settings — a Gemini API key (easiest) or local Ollama (fully private). Meanwhile, try: "how\'s today going?" · "when did I last open leetcode?" · "remind me to stretch in 20 minutes".';

const OLLAMA_ERROR_FALLBACK =
  "I couldn't reach the local model just now — is Ollama running? I can still do \"how's today going?\" and \"when did I last…\" from memory.";

const GEMINI_ERROR_FALLBACK =
  "I couldn't reach Gemini just now — worth checking the API key in Settings. Memory, today's story, and reminders all still work.";

/** Evening-story polish (roadmap Week 6): the template story is the source
 * of truth; a local model may only rephrase it. Any failure → template wins. */
export async function polishStory(story: string): Promise<string> {
  const settings = await getSettings();
  if (!settings.ollama.enabled) return story;
  try {
    const polished = await ollamaChat({
      model: settings.ollama.model,
      system: buildSystemPrompt({ profile: await getProfile(), todayContext: story }),
      messages: [
        {
          role: 'user',
          content: `Retell this evening note to your human in your own voice. Keep every fact, number, and time exactly as given; 2–3 sentences; no preamble:\n\n${story}`,
        },
      ],
    });
    // A model that rambles or drops content doesn't get to speak.
    return polished.length > 20 && polished.length < story.length * 3 ? polished : story;
  } catch {
    return story;
  }
}

export async function chatRespond(
  text: string,
  history: ChatMessage[],
  screenContext?: string,
): Promise<string> {
  let q = text.trim();
  const now = Date.now();

  // "Hey Nomi, …" works everywhere — strip the wake phrase, then listen.
  const wakePrefix =
    q.match(/^(?:hey|hi|ok|yo|hello)[,!\s]+nomi[,!.\s]*/i) ?? q.match(/^nomi[,!.\s]+/i);
  if (wakePrefix) q = q.slice(wakePrefix[0].length).trim();
  if (wakePrefix && !q) return "Hey — I'm listening. What do you need?";

  // "what are my reminders?" — show everything currently held.
  if (/\b(what|list|show|any|see|check)\b.*\breminders?\b|^my reminders/i.test(q) && !parseReminder(q)) {
    const { 'nomi:reminders': held } = await chrome.storage.local.get('nomi:reminders');
    const upcoming = Object.values((held ?? {}) as Record<string, { what?: string; at?: number }>)
      .filter((r) => typeof r === 'object' && r.at && r.at > now)
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    if (upcoming.length === 0) {
      return 'Nothing pending right now. Hand me one — "remind me to stretch in 20 minutes".';
    }
    return (
      'Holding: ' +
      upcoming
        .map((r) => {
          const m = Math.max(1, Math.round(((r.at ?? now) - now) / 60000));
          return `"${r.what}" in ${m} minute${m === 1 ? '' : 's'}`;
        })
        .join(' · ') +
      '.'
    );
  }

  // "how many jobs did I apply to?" — count from the activity journal.
  if (isCountQuery(q)) {
    const { count, matched, window } = countEntries(q, await getJournal(), now);
    if (count === 0) {
      return "I don't have any of those logged yet. Tell me things like \"I applied to a job\" and I'll keep count.";
    }
    const when = window === 'ever' ? '' : ` ${window}`;
    const recent = matched
      .slice(-3)
      .reverse()
      .map((e) => `• ${e.text}`)
      .join('\n');
    return `${count}${when}. Most recent:\n${recent}`;
  }

  // "I applied to a job" / "log that I finished X" — record it, don't turn it
  // into a timer. This is the fix for reminders misfiring on statements.
  if (!/\bremind me\b/i.test(q) && !isSaveLink(q)) {
    const logged = parseLog(q);
    if (logged) {
      await logEntry(logged);
      return `Logged: "${logged}". Ask me "how many…" anytime and I'll count them.`;
    }
  }

  // Personal Bag — "save this", "keep it in the bag/memory". Handled before
  // reminders so it never gets mistaken for a timer.
  if (isSaveLink(q)) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const clean = tab?.url ? observableUrl(tab.url) : null;
    if (!tab?.url || !clean) return "I can't save this page — it's a private or browser page.";
    const saved = await saveLink({
      url: tab.url.split('#')[0],
      title: (tab.title ?? clean.domain).slice(0, 160),
      domain: clean.domain,
    });
    return `Kept it — "${saved.title}" is in your bag. Ask "what did I save?" whenever.`;
  }

  // Context-triggered reminder — "remind me when I open Gmail to …". Checked
  // before the plain time reminder because it's the more specific shape.
  if (/\bremind me\b/i.test(q)) {
    const site = parseSiteReminder(q);
    if (site) {
      const id = crypto.randomUUID();
      const { 'nomi:siteReminders': existing } = await chrome.storage.local.get('nomi:siteReminders');
      await chrome.storage.local.set({
        'nomi:siteReminders': {
          ...(existing ?? {}),
          [id]: { domain: site.domain, what: site.what, createdTs: now },
        },
      });
      return confirmSiteReminder(site);
    }
  }

  const reminder = parseReminder(q);
  if (reminder) {
    const id = crypto.randomUUID();
    const { 'nomi:reminders': reminders } = await chrome.storage.local.get('nomi:reminders');
    await chrome.storage.local.set({
      'nomi:reminders': {
        ...(reminders ?? {}),
        [id]: { what: reminder.what, at: now + reminder.delayMs },
      },
    });
    chrome.alarms.create(`nomi:reminder:${id}`, { when: now + reminder.delayMs });
    return confirmText(reminder);
  }

  // Personal Bag recall — "which link did I save about X?"
  if (isRecallLinks(q)) {
    const hits = searchLinks(q, await getLinks());
    if (hits.length === 0) return "Your bag is empty so far. Say \"remember this link\" on any page.";
    return (
      'From your bag:\n' +
      hits
        .slice(0, 4)
        .map((l) => `• ${l.title} — ${l.domain} (${new Date(l.ts).toLocaleDateString()})`)
        .join('\n')
    );
  }

  // "remember that I ..." — a fact about the person, stored forever.
  const remember = parseRemember(q);
  if (remember) {
    await addFact(remember);
    return `Got it — I'll remember that. (You can see and edit everything I know in Settings → What I remember.)`;
  }

  // "forget that / forget about X" — the user stays in control of memory.
  if (/^(?:nomi[,\s]+)?forget\b/i.test(q)) {
    const profile = await getProfile();
    if (profile.facts.length === 0) return "There's nothing saved about you to forget yet.";
    const target = q.replace(/^(?:nomi[,\s]+)?forget\s*(?:that|about)?\s*/i, '').trim();
    if (!target || /^(that|it|the last( one)?)$/i.test(target)) {
      const last = profile.facts[profile.facts.length - 1];
      await removeFact(last.id);
      return `Done — forgot "${last.text}".`;
    }
    const match = profile.facts.find((f) => f.text.toLowerCase().includes(target.toLowerCase()));
    if (match) {
      await removeFact(match.id);
      return `Done — forgot "${match.text}".`;
    }
    return "I couldn't find that among what I remember. Try Settings → What I remember to clear it.";
  }

  // Passively pick up the user's name if we don't have it yet.
  const profileNow = await getProfile();
  if (!profileNow.name) {
    const spotted = parseName(q);
    if (spotted) {
      await saveProfile({ ...profileNow, name: spotted });
      return `Nice to properly meet you, ${spotted}. I'll remember that.`;
    }
  }

  // A buddy answers hello like a person, not like a search box.
  if (/^(hi+|hey+|hello+|yo|sup|good (morning|afternoon|evening))[\s!.]*$/i.test(q)) {
    const hi = profileNow.name ? `Hey ${profileNow.name}!` : 'Hey!';
    return `${hi} Right here beside you. Ask for today's story, dig up a memory, or just talk.`;
  }
  if (/^(thanks|thank you|thx|ty)\b/i.test(q)) {
    return "Anytime. I'm not going anywhere.";
  }
  if (/\b(who|what) (are|r) (you|u)\b/i.test(q)) {
    const p = PERSONALITIES[profileNow.personality] ?? PERSONALITIES.friend;
    return `I'm Nomi — your companion sharing your workspace, in ${p.label.toLowerCase()} mode right now. I notice how your day flows, remember what matters${profileNow.name ? `, ${profileNow.name}` : ''}, and everything stays on this device.`;
  }
  if (/what can you do|^help[\s!?]*$|how do (i|you) work/i.test(q)) {
    return 'Talk to me about anything — I can see the page you\'re on and I remember you. Try: "analyze this page" · "how\'s today going?" · "remember I\'m prepping for interviews" · "remind me to stretch in 20 min" · "focus with me for 25 minutes".';
  }

  // "focus with me for 25 minutes" / "for an hour" / "for half an hour" —
  // fully dynamic, any duration (Core Vision #2). Nomi holds the clock.
  const focus = q.match(
    /focus (?:with me )?(?:for )?(\d+|an?|half an|a couple(?: of)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i,
  );
  if (focus) {
    const isHour = /^h/i.test(focus[2]);
    const wordNum: Record<string, number> = { a: 1, an: 1, 'half an': 0.5, 'a couple': 2, 'a couple of': 2 };
    const qty = /^\d+$/.test(focus[1]) ? Number(focus[1]) : (wordNum[focus[1].toLowerCase()] ?? 1);
    const mins = Math.max(1, Math.round(qty * (isHour ? 60 : 1)));
    const until = now + mins * 60000;
    await chrome.storage.local.set({ 'nomi:focusSession': { until, minutes: mins } });
    chrome.alarms.create('nomi:focusEnd', { when: until });
    await chrome.storage.session.set({ 'nomi:mood': { kind: 'focus' } });
    return `${mins} minutes, heads down. I'll keep everything quiet and hold the clock — go.`;
  }

  if (/how('s| is| was)? (it going|today|the day)|today so far|what (did|have) i (do|done)/i.test(q)) {
    const rollup = await todayRollup(now);
    return rollup.totalMs < 60000 ? todayLine(now) : narrate(rollup);
  }

  if (isMemoryQuery(q)) {
    return searchMemory(q, {
      sessions: await sessionsSince(0),
      rollups: await allRollups(),
      events: await eventsSince(0),
      now,
    });
  }

  const settings = await getSettings();
  // Search the user's own documents first — answer from their material when
  // it fits, before reaching for general knowledge.
  const docHits = searchDocs(q, await getDocs());
  const docContext = docHits.length
    ? docHits.map((h) => `[${h.docName}] ${h.passage}`).join('\n---\n')
    : undefined;
  const system = buildSystemPrompt({
    profile: profileNow,
    todayContext: await todayLine(now),
    screenContext,
    docContext,
  });
  const messages = [
    ...history.slice(-8).map((m) => ({
      role: m.role === 'nomi' ? ('assistant' as const) : ('user' as const),
      content: m.text,
    })),
    { role: 'user' as const, content: q },
  ];

  // Provider chain: best brain first, each failure falls through to the
  // next, so a quota error never reads as Nomi going silent.
  const providers: (() => Promise<string>)[] = [];
  if (settings.gemini.enabled && settings.gemini.apiKey.trim()) {
    providers.push(() =>
      geminiChat({
        apiKey: settings.gemini.apiKey.trim(),
        model: settings.gemini.model,
        system,
        messages,
      }),
    );
  }
  if (settings.ollama.enabled) {
    providers.push(() => ollamaChat({ model: settings.ollama.model, system, messages }));
  }
  if (settings.freeChat) {
    providers.push(() => freeChat({ system, messages }));
  }

  if (providers.length === 0) return NO_LLM_FALLBACK;

  let lastError = '';
  for (const provider of providers) {
    try {
      return await provider();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (lastError.startsWith('gemini')) return GEMINI_ERROR_FALLBACK;
  if (settings.ollama.enabled && !settings.freeChat) return OLLAMA_ERROR_FALLBACK;
  return "Every chat brain I can reach is having a moment — try me again in a minute. Today's story, memory, and reminders all still work.";
}
