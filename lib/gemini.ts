/** Opt-in cloud chat via the Gemini API. This is the ONE feature that sends
 * anything off-device (chat messages + the one-line today summary), it is
 * off by default, and Settings says so in plain words. Memory, tracking,
 * and everything else stay local regardless. */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Natural human voice via Gemini TTS. Returns raw PCM (base64) + sample
 * rate; the caller wraps it in WAV. Warm female voices: Leda, Aoede, Kore. */
export async function geminiTTS(opts: {
  apiKey: string;
  text: string;
  voice?: string;
}): Promise<{ b64: string; rate: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${BASE}/gemini-2.5-flash-preview-tts:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: opts.text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice ?? 'Leda' } },
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const json = await res.json();
    const part = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    const b64 = part?.inlineData?.data;
    if (!b64) throw new Error('no audio');
    const mime: string = part.inlineData.mimeType ?? '';
    const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
    return { b64, rate };
  } finally {
    clearTimeout(t);
  }
}

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

/** Speech-to-text via Gemini's audio input: the recorded clip is sent once,
 * transcribed, and the reply is just the transcript. */
export async function geminiTranscribe(opts: {
  apiKey: string;
  model: string;
  b64: string;
  mime: string;
  language?: 'en' | 'hinglish';
}): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  const instruction =
    opts.language === 'hinglish'
      ? 'Transcribe this speech exactly as spoken. The speaker mixes Hindi and English (Hinglish) — write Hindi words in Roman/Latin script (e.g. "kya haal hai", "mujhe yaad dila do"), keep English words as English. Reply with ONLY the transcript text — no quotes, no commentary, no Devanagari. If there is no intelligible speech, reply with an empty response.'
      : 'Transcribe this speech exactly as spoken. Reply with ONLY the transcript text — no quotes, no commentary. If there is no intelligible speech, reply with an empty response.';
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: instruction },
              { inlineData: { mimeType: opts.mime, data: opts.b64 } },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 200, temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const json = await res.json();
    return (
      json?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? '')
        .join('')
        .trim() ?? ''
    );
  } finally {
    clearTimeout(t);
  }
}

/** Vision (V2 Upgrade 4): send one captured frame + an extraction prompt, get
 * back the model's text (the caller parses it into structure). The image is the
 * caller's to discard — this function keeps no copy. */
export async function geminiVision(opts: {
  apiKey: string;
  model: string;
  b64: string;
  mime: string;
  prompt: string;
}): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: opts.prompt },
              { inlineData: { mimeType: opts.mime, data: opts.b64 } },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 500, temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const json = await res.json();
    return (
      json?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? '')
        .join('')
        .trim() ?? ''
    );
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
