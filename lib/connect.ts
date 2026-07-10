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

export interface Connections {
  leetcode?: LeetCodeStats;
  github?: GitHubStats;
}

export const CONNECT_KEY = 'nomi:connect';

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
