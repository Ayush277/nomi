import { isMemoryQuery, searchMemory } from './memory';
import { narrate } from './narrative';
import { ollamaChat, personaPrompt } from './ollama';
import { getSettings } from './settings';
import { allRollups, sessionsSince } from './store';
import { todayLine, todayRollup } from './summary';
import type { ChatMessage } from './types';

/** Background-side chat brain (ADR-4): intent handlers work with no LLM;
 * freeform conversation upgrades in when the user has Ollama running. */

const NO_LLM_FALLBACK =
  "Freeform chat needs a local model (free — it runs entirely on your machine; see Settings → Local AI). Meanwhile I can still answer things like \"how's today going?\" or \"when did I last open leetcode?\"";

const LLM_ERROR_FALLBACK =
  "I couldn't reach the local model just now — is Ollama running? I can still do \"how's today going?\" and \"when did I last…\" from memory.";

export async function chatRespond(text: string, history: ChatMessage[]): Promise<string> {
  const q = text.trim();
  const now = Date.now();

  if (/how('s| is| was)? (it going|today|the day)|today so far|what (did|have) i (do|done)/i.test(q)) {
    const rollup = await todayRollup(now);
    return rollup.totalMs < 60000 ? todayLine(now) : narrate(rollup);
  }

  if (isMemoryQuery(q)) {
    return searchMemory(q, {
      sessions: await sessionsSince(0),
      rollups: await allRollups(),
      now,
    });
  }

  const settings = await getSettings();
  if (!settings.ollama.enabled) return NO_LLM_FALLBACK;

  try {
    return await ollamaChat({
      model: settings.ollama.model,
      system: personaPrompt(await todayLine(now)),
      messages: [
        ...history.slice(-8).map((m) => ({
          role: m.role === 'nomi' ? ('assistant' as const) : ('user' as const),
          content: m.text,
        })),
        { role: 'user', content: q },
      ],
    });
  } catch {
    return LLM_ERROR_FALLBACK;
  }
}
