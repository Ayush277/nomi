/** Opt-in cloud chat via the Gemini API. This is the ONE feature that sends
 * anything off-device (chat messages + the one-line today summary), it is
 * off by default, and Settings says so in plain words. Memory, tracking,
 * and everything else stay local regardless. */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function geminiChat(opts: {
  apiKey: string;
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': opts.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: opts.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 300, temperature: 0.8 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`gemini ${res.status}${body.includes('API_KEY_INVALID') ? ' (invalid key)' : ''}`);
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '')
      .join('')
      .trim();
    if (!text) throw new Error('empty response');
    return text;
  } finally {
    clearTimeout(t);
  }
}

/** Cheap connectivity/key check for the Settings test button. */
export async function geminiAvailable(apiKey: string, model: string): Promise<boolean> {
  try {
    await geminiChat({
      apiKey,
      model,
      system: 'Reply with the single word: ok',
      messages: [{ role: 'user', content: 'ping' }],
    });
    return true;
  } catch {
    return false;
  }
}
