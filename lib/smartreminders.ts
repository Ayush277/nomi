/** Context-triggered reminders (Core Vision #13): "remind me when I open
 * Gmail to reply to the Anthropic email" — fires on the next visit to a
 * site, not at a time. Pure parsing here; the background stores & matches. */

const SITE_ALIASES: Record<string, string> = {
  gmail: 'mail.google.com',
  email: 'mail.google.com',
  mail: 'mail.google.com',
  inbox: 'mail.google.com',
  youtube: 'youtube.com',
  yt: 'youtube.com',
  github: 'github.com',
  leetcode: 'leetcode.com',
  twitter: 'twitter.com',
  x: 'x.com',
  linkedin: 'linkedin.com',
  reddit: 'reddit.com',
  gpt: 'chatgpt.com',
  chatgpt: 'chatgpt.com',
  notion: 'notion.so',
  calendar: 'calendar.google.com',
  drive: 'drive.google.com',
  discord: 'discord.com',
  spotify: 'open.spotify.com',
};

export interface SiteReminder {
  domain: string;
  what: string;
}

function resolveSite(raw: string): string | null {
  const s = raw.toLowerCase().replace(/^www\./, '').trim();
  if (SITE_ALIASES[s]) return SITE_ALIASES[s];
  if (/^[a-z0-9-]+\.[a-z]{2,}(\.[a-z]{2,})?$/.test(s)) return s; // looks like a domain
  return null;
}

/** Returns {domain, what} for a site-triggered reminder, or null. */
export function parseSiteReminder(text: string): SiteReminder | null {
  // "...when(ever) I('m)? (next)? (open|on|visit|go to|get to|reach|am on) [the] SITE (to WHAT)"
  const m = text.match(
    /\bwhen(?:ever)?\s+i(?:'m| am)?\s*(?:next\s+)?(?:open|on|visit|going to|go to|get to|reach|am on|use)?\s*(?:the\s+)?([a-zA-Z][\w.-]*)\b\s*(?:to\b\s*)?(.*)$/i,
  );
  if (!m) return null;
  const domain = resolveSite(m[1]);
  if (!domain) return null;

  let what = m[2].trim().replace(/[.!?]+$/, '').trim();
  // Recover the intent verb if the phrasing put it before the site.
  if (!what) {
    const pre = text.match(/remind me(?:\s+tomorrow)?\s+(?:to\s+)?(.+?)\s+when(?:ever)?\s+i/i);
    what = pre ? pre[1].trim() : '';
  }
  if (!what) return null;
  return { domain, what };
}

export function confirmSiteReminder(r: SiteReminder): string {
  return `Got it — next time you open ${r.domain}, I'll remind you: ${r.what}.`;
}

/** Match the domain the user just landed on against pending site reminders.
 * Suffix match so "mail.google.com" matches a reminder for "google.com" too. */
export function matchSiteReminder(
  domain: string,
  reminders: Record<string, SiteReminder & { createdTs: number }>,
  now: number,
): { id: string; reminder: SiteReminder } | null {
  const host = domain.toLowerCase();
  for (const [id, r] of Object.entries(reminders)) {
    // Don't fire on the very page where it was set (give it 60s / a real revisit).
    if (now - r.createdTs < 60000) continue;
    if (host === r.domain || host.endsWith('.' + r.domain) || r.domain.endsWith('.' + host)) {
      return { id, reminder: r };
    }
  }
  return null;
}
