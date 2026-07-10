/** Keyless free cloud chat via pollinations.ai — the safety net at the end
 * of the provider chain, so conversation never dead-ends on a quota error.
 * No account, no key. When used, the chat messages go to pollinations.ai;
 * Settings says so next to the toggle. The service is community-run and
 * occasionally flaky — every failure falls through gracefully. */

const BASE = 'https://text.pollinations.ai';

export async function freeChat(opts: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string> {
  const convo =
    opts.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Nomi'}: ${m.content}`)
      .join('\n') + '\nNomi:';
  const url = `${BASE}/${encodeURIComponent(convo)}?system=${encodeURIComponent(opts.system)}&model=openai`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`freechat ${res.status}`);
    const text = (await res.text()).trim();
    // Guard against error pages and echoes sneaking through as "replies".
    if (!text || text.startsWith('<') || text.length > 2000) throw new Error('bad response');
    return text.replace(/^Nomi:\s*/i, '');
  } finally {
    clearTimeout(t);
  }
}
