import type { SiteCategory } from './types';

/** Tier 1 domain → category map (ADR-5). Suffix-matched, so "gist.github.com"
 * resolves via "github.com". Extend freely; unknown domains fall to 'other'. */
export const SITE_CATEGORIES: Record<string, SiteCategory> = {
  // coding
  'leetcode.com': 'coding',
  'codeforces.com': 'coding',
  'github.com': 'coding',
  'gitlab.com': 'coding',
  'stackoverflow.com': 'coding',
  'stackexchange.com': 'coding',
  'replit.com': 'coding',
  'codesandbox.io': 'coding',
  'vscode.dev': 'coding',
  // learning / docs
  'developer.mozilla.org': 'learning',
  'docs.python.org': 'learning',
  'react.dev': 'learning',
  'nextjs.org': 'learning',
  'wikipedia.org': 'learning',
  'coursera.org': 'learning',
  'udemy.com': 'learning',
  'khanacademy.org': 'learning',
  'geeksforgeeks.org': 'learning',
  'medium.com': 'learning',
  'dev.to': 'learning',
  // social
  'twitter.com': 'social',
  'x.com': 'social',
  'reddit.com': 'social',
  'instagram.com': 'social',
  'facebook.com': 'social',
  'discord.com': 'social',
  'whatsapp.com': 'social',
  // entertainment
  'youtube.com': 'entertainment',
  'netflix.com': 'entertainment',
  'twitch.tv': 'entertainment',
  'primevideo.com': 'entertainment',
  'hotstar.com': 'entertainment',
  // shopping
  'amazon.com': 'shopping',
  'amazon.in': 'shopping',
  'flipkart.com': 'shopping',
  'ebay.com': 'shopping',
  // career
  'linkedin.com': 'career',
  'naukri.com': 'career',
  'indeed.com': 'career',
  'glassdoor.com': 'career',
  'internshala.com': 'career',
  // music
  'spotify.com': 'music',
  'music.youtube.com': 'music',
  'soundcloud.com': 'music',
};

/** Sensitive domains: Nomi records NOTHING here — no events at all (ADR-5).
 * Starter list; grows over time and is supplemented by the user's own
 * exclusion list. Suffix-matched like SITE_CATEGORIES. */
export const SENSITIVE_DOMAINS: string[] = [
  // banking / payments
  'chase.com',
  'wellsfargo.com',
  'bankofamerica.com',
  'citibank.com',
  'hdfcbank.com',
  'icicibank.com',
  'sbi.co.in',
  'onlinesbi.sbi',
  'paypal.com',
  'stripe.com',
  'wise.com',
  'venmo.com',
  // health
  'mychart.com',
  'healthcare.gov',
  'practo.com',
  'webmd.com',
  // mail is private by default in Phase 1 (revisit with an opt-in adapter later)
  'mail.google.com',
  'outlook.live.com',
  'proton.me',
];
