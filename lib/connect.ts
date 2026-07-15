/** Read-only account sync (Core Vision #11) — LOCAL and public-only, so it
 * fits the local-first promise: no OAuth, no server, no writes. We fetch a
 * user's PUBLIC stats from LeetCode & GitHub and cache them on-device. The
 * extension's host permission lets these cross-origin fetches through. */

export interface LeetCodeStats {
  username: string;
  total: number;
  easy: number;
  medium: number;
  hard: number;
  syncedTs: number;
}

export interface GitHubStats {
  username: string;
  repos: number;
  followers: number;
  recentCommits: number;
  syncedTs: number;
}

/** A lightweight linked tool (Notion, Obsidian, Calendar, …). No OAuth — a
 * local reference Nomi is aware of and can open for you. Honest to local-first:
 * we don't sync their private data, we just know they're part of your world. */
export interface LinkedTool {
  id: string;
  key: string; // canonical, e.g. 'notion'
  name: string; // display, e.g. 'Notion'
  url?: string;
  note?: string;
  addedTs: number;
}

export interface Connections {
  leetcode?: LeetCodeStats;
  github?: GitHubStats;
  tools?: LinkedTool[];
}

export const CONNECT_KEY = 'nomi:connect';

/** Apps Nomi recognizes by name, with a sensible open URL. */
export const KNOWN_TOOLS: Record<string, { name: string; url: string }> = {
  notion: { name: 'Notion', url: 'https://www.notion.so' },
  obsidian: { name: 'Obsidian', url: 'obsidian://open' },
  calendar: { name: 'Google Calendar', url: 'https://calendar.google.com' },
  'google calendar': { name: 'Google Calendar', url: 'https://calendar.google.com' },
  gcal: { name: 'Google Calendar', url: 'https://calendar.google.com' },
  gmail: { name: 'Gmail', url: 'https://mail.google.com' },
  github: { name: 'GitHub', url: 'https://github.com' },
  leetcode: { name: 'LeetCode', url: 'https://leetcode.com' },
  linear: { name: 'Linear', url: 'https://linear.app' },
  figma: { name: 'Figma', url: 'https://figma.com' },
  drive: { name: 'Google Drive', url: 'https://drive.google.com' },
  slack: { name: 'Slack', url: 'https://slack.com' },
  todoist: { name: 'Todoist', url: 'https://todoist.com' },
  trello: { name: 'Trello', url: 'https://trello.com' },
};

export function resolveTool(raw: string): { key: string; name: string; url?: string } | null {
  const s = raw.toLowerCase().trim().replace(/^(the|my)\s+/i, '');
  const known = KNOWN_TOOLS[s];
  if (known) return { key: s.replace(/\s+/g, '-'), name: known.name, url: known.url };
  if (s.length > 1 && s.length < 30) {
    // Unknown but nameable — link it as a plain tool.
    return { key: s.replace(/\s+/g, '-'), name: raw.trim().replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  return null;
}

export async function addLinkedTool(raw: string, url?: string): Promise<LinkedTool | null> {
  const r = resolveTool(raw);
  if (!r) return null;
  const conns = await getConnections();
  const tools = conns.tools ?? [];
  const existing = tools.find((t) => t.key === r.key);
  const tool: LinkedTool = existing ?? {
    id: crypto.randomUUID(),
    key: r.key,
    name: r.name,
    url: url ?? r.url,
    addedTs: Date.now(),
  };
  if (url) tool.url = url;
  const next = existing ? tools.map((t) => (t.key === r.key ? tool : t)) : [...tools, tool];
  await patchConnections({ tools: next });
  return tool;
}

export async function removeLinkedTool(key: string): Promise<void> {
  const conns = await getConnections();
  await patchConnections({ tools: (conns.tools ?? []).filter((t) => t.key !== key) });
}

/** A compact, model-readable summary of everything the user has connected. */
export function describeConnections(c: Connections): string {
  const parts: string[] = [];
  if (c.leetcode) parts.push(`LeetCode @${c.leetcode.username}: ${c.leetcode.total} solved (${c.leetcode.hard} hard)`);
  if (c.github) parts.push(`GitHub @${c.github.username}: ${c.github.repos} repos, ${c.github.recentCommits} recent commits`);
  for (const t of c.tools ?? []) parts.push(`${t.name}${t.url ? ` (${t.url})` : ''}`);
  return parts.length ? parts.join('\n') : 'No accounts or tools linked yet.';
}

export async function getConnections(): Promise<Connections> {
  const stored = await chrome.storage.local.get(CONNECT_KEY);
  return (stored[CONNECT_KEY] ?? {}) as Connections;
}

async function patchConnections(patch: Partial<Connections>): Promise<Connections> {
  const next = { ...(await getConnections()), ...patch };
  await chrome.storage.local.set({ [CONNECT_KEY]: next });
  return next;
}

export async function syncLeetCode(username: string): Promise<LeetCodeStats> {
  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($u:String!){ matchedUser(username:$u){ submitStatsGlobal{ acSubmissionNum{ difficulty count } } } }`,
      variables: { u: username },
    }),
  });
  if (!res.ok) throw new Error(`leetcode ${res.status}`);
  const json = await res.json();
  const nums = json?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum;
  if (!Array.isArray(nums)) throw new Error('no such user');
  const by = (d: string) => nums.find((n: any) => n.difficulty === d)?.count ?? 0;
  const stats: LeetCodeStats = {
    username,
    total: by('All'),
    easy: by('Easy'),
    medium: by('Medium'),
    hard: by('Hard'),
    syncedTs: Date.now(),
  };
  await patchConnections({ leetcode: stats });
  return stats;
}

export async function syncGitHub(username: string): Promise<GitHubStats> {
  const [userRes, evRes] = await Promise.all([
    fetch(`https://api.github.com/users/${encodeURIComponent(username)}`),
    fetch(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`),
  ]);
  if (!userRes.ok) throw new Error(userRes.status === 404 ? 'no such user' : `github ${userRes.status}`);
  const user = await userRes.json();
  const events = evRes.ok ? await evRes.json() : [];
  const recentCommits = Array.isArray(events)
    ? events
        .filter((e: any) => e.type === 'PushEvent')
        .reduce((n: number, e: any) => n + (e.payload?.commits?.length ?? 0), 0)
    : 0;
  const stats: GitHubStats = {
    username,
    repos: user.public_repos ?? 0,
    followers: user.followers ?? 0,
    recentCommits,
    syncedTs: Date.now(),
  };
  await patchConnections({ github: stats });
  return stats;
}

export async function disconnect(which: 'leetcode' | 'github'): Promise<void> {
  const conns = await getConnections();
  delete conns[which];
  await chrome.storage.local.set({ [CONNECT_KEY]: conns });
}
