/** Project Detection (V2 Upgrade 3) — groups pages under the thing the user is
 * actually working on ("Nomi", "Resume", "Google Internship") so the AI can say
 * "you're working on Nomi" instead of "you're browsing GitHub". Pure inference
 * (unit-testable) + a tiny user-editable project list stored like the journal.
 *
 * Zero-config default that already works: a GitHub repo path becomes a project.
 * On top of that the user (or later phases) can add named projects with
 * keywords, which win over the auto-detected repo. */

export interface Project {
  id: string;
  name: string;
  /** Lowercased substrings matched against "domain path title". */
  keywords: string[];
  createdTs: number;
  lastSeenTs: number;
}

const PROJECTS_KEY = 'nomi:projects';

export interface PageRef {
  domain: string;
  path?: string;
  title?: string;
}

/** Best-guess project name for a page, or null. User projects win; otherwise a
 * GitHub/GitLab repo slug is a sensible automatic project. Pure. */
export function inferProject(page: PageRef, projects: Project[]): string | null {
  const hay = `${page.domain} ${page.path ?? ''} ${page.title ?? ''}`.toLowerCase();

  // User-defined projects first — a keyword or the name appearing anywhere.
  for (const p of projects) {
    const needles = [p.name.toLowerCase(), ...p.keywords.map((k) => k.toLowerCase())];
    if (needles.some((n) => n.length > 1 && hay.includes(n))) return p.name;
  }

  // Auto: github.com/<owner>/<repo> or gitlab → the repo is the project. Skip
  // GitHub's reserved top-level routes (the "owner" slot isn't a user then).
  if (/(?:^|\.)(?:github|gitlab)\.com$/.test(page.domain)) {
    const m = (page.path ?? '').match(/^\/([^/]+)\/([^/]+)/);
    const RESERVED = new Set([
      'settings', 'notifications', 'orgs', 'search', 'marketplace', 'explore',
      'pulls', 'issues', 'new', 'login', 'join', 'about', 'topics', 'sponsors', 'apps',
    ]);
    if (m && !RESERVED.has(m[1].toLowerCase())) {
      return m[2].replace(/[-_]/g, ' ');
    }
  }
  return null;
}

export async function getProjects(): Promise<Project[]> {
  const stored = await chrome.storage.local.get(PROJECTS_KEY);
  return (stored[PROJECTS_KEY] ?? []) as Project[];
}

export async function addProject(name: string, keywords: string[] = []): Promise<Project> {
  const projects = await getProjects();
  const existing = projects.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) {
    // Merge new keywords into the existing project rather than duplicate it.
    const merged = new Set([...existing.keywords, ...keywords.map((k) => k.trim()).filter(Boolean)]);
    existing.keywords = [...merged];
    existing.lastSeenTs = Date.now();
    await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
    return existing;
  }
  const project: Project = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 80),
    keywords: keywords.map((k) => k.trim()).filter(Boolean),
    createdTs: Date.now(),
    lastSeenTs: Date.now(),
  };
  await chrome.storage.local.set({ [PROJECTS_KEY]: [...projects, project].slice(-50) });
  return project;
}

/** "call this project X" / "I'm working on X" — a light way to name the current
 * project from chat. Returns the project name to create, or null. */
export function parseProjectCommand(text: string): string | null {
  const m = text.match(
    /\b(?:this (?:is|belongs to)|call this|tag this as|i'?m working on|working on)\s+(?:the\s+|my\s+|project\s+)?["']?([\w][\w .-]{1,60})["']?\s*(?:project)?\s*$/i,
  );
  if (!m) return null;
  const name = m[1].trim().replace(/\bproject$/i, '').trim();
  return name.length > 1 ? name : null;
}
