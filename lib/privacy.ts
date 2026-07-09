import { SENSITIVE_DOMAINS, SITE_CATEGORIES } from './sites';
import type { SiteCategory } from './types';

/** Everything the tracker is allowed to know about a URL.
 * Query strings and fragments never leave this function (ADR-5). */
export interface SanitizedUrl {
  domain: string;
  path: string;
}

/** Returns hostname + pathname for http(s) pages, null for anything else
 * (chrome://, about:, file:, extension pages, new tab, ...). */
export function sanitizeUrl(raw: string | undefined | null): SanitizedUrl | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return { domain: url.hostname.toLowerCase(), path: url.pathname };
}

/** True when `domain` equals `candidate` or is a subdomain of it. */
function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith('.' + candidate);
}

function findBySuffix<T>(domain: string, table: Record<string, T>): T | undefined {
  // Prefer the most specific match ("music.youtube.com" over "youtube.com").
  let best: { key: string; value: T } | undefined;
  for (const [key, value] of Object.entries(table)) {
    if (domainMatches(domain, key) && (!best || key.length > best.key.length)) {
      best = { key, value };
    }
  }
  return best?.value;
}

export function categorize(domain: string): SiteCategory {
  return findBySuffix(domain, SITE_CATEGORIES) ?? 'other';
}

/** Hard-blocked: no events, no sessions, nothing (ADR-5).
 * `userExclusions` is the user's own list from settings. */
export function isSensitive(domain: string, userExclusions: string[] = []): boolean {
  return (
    SENSITIVE_DOMAINS.some((d) => domainMatches(domain, d)) ||
    userExclusions.some((d) => domainMatches(domain, d.toLowerCase()))
  );
}

/** Single gate every observation must pass before an event may be created. */
export function observableUrl(
  raw: string | undefined | null,
  userExclusions: string[] = [],
): (SanitizedUrl & { category: SiteCategory }) | null {
  const clean = sanitizeUrl(raw);
  if (!clean) return null;
  if (isSensitive(clean.domain, userExclusions)) return null;
  return { ...clean, category: categorize(clean.domain) };
}
