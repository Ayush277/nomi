import { geminiChat } from './gemini';
import { isMemoryQuery, searchMemory } from './memory';
import { narrate } from './narrative';
import { ollamaChat, personaPrompt } from './ollama';
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
      system: personaPrompt(story),
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

export async function chatRespond(text: string, history: ChatMessage[]): Promise<string> {
  const q = text.trim();
  const now = Date.now();

  const reminder = parseReminder(q);
  if (reminder) {
    const id = crypto.randomUUID();
    const { 'nomi:reminders': reminders } = await chrome.storage.local.get('nomi:reminders');
    await chrome.storage.local.set({
      'nomi:reminders': { ...(reminders ?? {}), [id]: reminder.what },
    });
    chrome.alarms.create(`nomi:reminder:${id}`, { when: now + reminder.delayMs });
    return confirmText(reminder);
  }

  // A buddy answers hello like a person, not like a search box.
  if (/^(hi+|hey+|hello+|yo|sup|good (morning|afternoon|evening))[\s!.]*$/i.test(q)) {
    return "Hey! Right here beside you. Ask for today's story, dig up a memory, or hand me a reminder.";
  }
  if (/^(thanks|thank you|thx|ty)\b/i.test(q)) {
    return "Anytime. I'm not going anywhere.";
  }
  if (/\b(who|what) (are|r) (you|u)\b/i.test(q)) {
    return "I'm Nomi — a quiet companion sharing your workspace. I notice how the day flows, remember it for you, and cheer when things land. Everything stays on this device.";
  }
  if (/what can you do|^help[\s!?]*$|how do (i|you) work/i.test(q)) {
    return 'What I do: "how\'s today going?" tells the story so far · "when did I last open leetcode?" searches memory · "remind me to stretch in 20 minutes" sets a nudge · "focus with me for 25 minutes" starts a quiet heads-down timer. Connect a local model in Settings and we can talk about anything.';
  }

  // "focus with me for 25 minutes" — Nomi holds the clock and keeps quiet.
  const focus = q.match(/focus (?:with me )?for (\d+)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i);
  if (focus) {
    const mins = Number(focus[1]) * (/^h/i.test(focus[2]) ? 60 : 1);
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
  const useGemini = settings.gemini.enabled && settings.gemini.apiKey.trim() !== '';
  if (!useGemini && !settings.ollama.enabled) return NO_LLM_FALLBACK;

  const system = personaPrompt(await todayLine(now));
  const messages = [
    ...history.slice(-8).map((m) => ({
      role: m.role === 'nomi' ? ('assistant' as const) : ('user' as const),
      content: m.text,
    })),
    { role: 'user' as const, content: q },
  ];

  if (useGemini) {
    try {
      return await geminiChat({
        apiKey: settings.gemini.apiKey.trim(),
        model: settings.gemini.model,
        system,
        messages,
      });
    } catch {
      // Fall through to Ollama if it's also configured.
      if (!settings.ollama.enabled) return GEMINI_ERROR_FALLBACK;
    }
  }

  try {
    return await ollamaChat({ model: settings.ollama.model, system, messages });
  } catch {
    return OLLAMA_ERROR_FALLBACK;
  }
}
