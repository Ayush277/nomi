/** Optional local LLM (ADR-4): Ollama over localhost. Nomi is fully
 * functional without it; when present it unlocks freeform chat. This is the
 * ONLY network call in the entire extension, it never leaves the machine,
 * and it only happens when the user has explicitly enabled it. */

const OLLAMA_URL = 'http://localhost:11434';

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export function personaPrompt(todayContext: string): string {
  return [
    "You are Nomi, a warm digital companion who shares the user's workspace.",
    'Voice: warm, brief, specific, lightly playful, never clinical. One to three sentences.',
    'You support and notice; you never control, judge, grade, or guilt.',
    'Never describe yourself as watching, monitoring, or tracking — you are simply here, alongside.',
    `What you know about today: ${todayContext}`,
  ].join(' ');
}

export async function ollamaChat(opts: {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: [{ role: 'system', content: opts.system }, ...opts.messages],
        options: { num_predict: 220 },
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const json = await res.json();
    const text = json?.message?.content?.trim();
    if (!text) throw new Error('empty response');
    return text;
  } finally {
    clearTimeout(t);
  }
}
