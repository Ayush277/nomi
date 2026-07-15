/** Intent Engine (V2 Upgrade 2) — instead of only storing browsing history,
 * Nomi stores *unfinished intentions*: things the user actually said they'd
 * do ("I need to finish the resume"). Pure parsing here; storage is
 * chrome.storage.local like the journal. (Auto-intentions inferred from
 * repeated visits were removed — they read raw URLs back as noise.)
 *
 * An Intention is a first-class todo-ish record with confidence/priority/etc,
 * NOT a timed reminder — reminders fire at a moment; intentions linger until
 * resolved and feed the companion brief + proactive nudges (Phase C). */

export type IntentPriority = 'low' | 'medium' | 'high';
export type IntentStatus = 'open' | 'done' | 'dismissed';
export type IntentEffort = 'quick' | 'medium' | 'deep';

export interface Intention {
  id: string;
  title: string;
  confidence: number; // 0–1
  priority: IntentPriority;
  deadline: number | null;
  status: IntentStatus;
  relatedProject: string | null;
  estimatedEffort: IntentEffort;
  createdTs: number;
  lastInteractionTs: number;
  source: 'phrase' | 'repeat-visit';
  domain?: string;
}

const INTENTS_KEY = 'nomi:intentions';

export interface ParsedIntent {
  title: string;
  confidence: number;
  priority: IntentPriority;
  estimatedEffort: IntentEffort;
}

const DEEP_VERBS = /\b(finish|build|write|refactor|implement|design|study|prepare|complete)\b/i;
const QUICK_VERBS = /\b(read|check|reply|respond|look at|watch|skim|review|email|message)\b/i;

function priorityOf(text: string): IntentPriority {
  if (/\b(must|have to|need to|gotta|urgent|asap|important|deadline)\b/i.test(text)) return 'high';
  if (/\b(maybe|might|could|sometime|eventually|at some point)\b/i.test(text)) return 'low';
  return 'medium';
}

function effortOf(text: string): IntentEffort {
  if (DEEP_VERBS.test(text)) return 'deep';
  if (QUICK_VERBS.test(text)) return 'quick';
  return 'medium';
}

function tidy(title: string): string {
  return title.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').slice(0, 120);
}

/** Extract an intention from a phrase, or null. Deliberately conservative to
 * avoid stealing from reminders / save-link / journal handlers. Pure. */
export function parseIntent(text: string): ParsedIntent | null {
  const t = text.trim();

  // "I should / need to / have to / want to <do X>"
  let m = t.match(/\bi\s+(?:should|need to|have to|gotta|must|want to|plan to|ought to)\s+(.+)/i);
  if (m) {
    const title = tidy(m[1]);
    if (!title) return null;
    return { title, confidence: 0.85, priority: priorityOf(t), estimatedEffort: effortOf(t) };
  }

  // "I'll <do X> later" / "read this later" / "come back to this"
  if (/\bi'?ll\s+.+\blater\b/i.test(t) || /\b(read|check|look at|watch)\s+(?:this|it|that)\s+later\b/i.test(t)) {
    const verb = t.match(/\b(read|check|look at|watch|finish|do)\b/i)?.[1] ?? 'get back to';
    return { title: tidy(`${verb} this`), confidence: 0.75, priority: 'low', estimatedEffort: effortOf(t) };
  }
  if (/\bcome back to (?:this|it|that)\b/i.test(t) || /\b(save|keep) this for later\b/i.test(t)) {
    return { title: 'come back to this', confidence: 0.7, priority: 'low', estimatedEffort: 'quick' };
  }

  // "note to self: X"
  m = t.match(/\bnote to self[:,]?\s*(.+)/i);
  if (m) return { title: tidy(m[1]), confidence: 0.9, priority: priorityOf(t), estimatedEffort: effortOf(t) };

  // "this looks useful / important" — a soft signal, low confidence.
  if (/\bthis\s+(?:looks|seems)\s+(?:useful|important|interesting|relevant|good)\b/i.test(t)) {
    return { title: 'look into this — flagged as useful', confidence: 0.5, priority: 'low', estimatedEffort: 'quick' };
  }
  return null;
}

// --- storage ---------------------------------------------------------------

export async function getIntentions(): Promise<Intention[]> {
  const stored = await chrome.storage.local.get(INTENTS_KEY);
  const all = (stored[INTENTS_KEY] ?? []) as Intention[];
  // The auto "you keep returning to <url>" intentions are gone (they were
  // noise — Meet links, chat threads). Purge any that are still stored, once.
  const real = all.filter((i) => i.source !== 'repeat-visit');
  if (real.length !== all.length) {
    await chrome.storage.local.set({ [INTENTS_KEY]: real });
  }
  return real;
}

export async function getOpenIntentions(): Promise<Intention[]> {
  return (await getIntentions())
    .filter((i) => i.status === 'open')
    .sort((a, b) => rank(b) - rank(a));
}

const PRIORITY_WEIGHT: Record<IntentPriority, number> = { high: 3, medium: 2, low: 1 };
function rank(i: Intention): number {
  const overdue = i.deadline && i.deadline < Date.now() ? 2 : 0;
  return PRIORITY_WEIGHT[i.priority] + i.confidence + overdue;
}

export async function addIntention(
  parsed: ParsedIntent,
  extra: Partial<Pick<Intention, 'relatedProject' | 'domain' | 'deadline' | 'source'>> = {},
): Promise<Intention> {
  const now = Date.now();
  const intention: Intention = {
    id: crypto.randomUUID(),
    title: parsed.title,
    confidence: parsed.confidence,
    priority: parsed.priority,
    deadline: extra.deadline ?? null,
    status: 'open',
    relatedProject: extra.relatedProject ?? null,
    estimatedEffort: parsed.estimatedEffort,
    createdTs: now,
    lastInteractionTs: now,
    source: extra.source ?? 'phrase',
    domain: extra.domain,
  };
  const all = await getIntentions();
  await chrome.storage.local.set({ [INTENTS_KEY]: [...all, intention].slice(-200) });
  return intention;
}

/** Mark the best-matching open intention resolved. Returns it, or null. */
export async function resolveIntention(
  match: (i: Intention) => boolean,
  status: IntentStatus = 'done',
): Promise<Intention | null> {
  const all = await getIntentions();
  const target = all.filter((i) => i.status === 'open').find(match);
  if (!target) return null;
  target.status = status;
  target.lastInteractionTs = Date.now();
  await chrome.storage.local.set({ [INTENTS_KEY]: all });
  return target;
}

/** Open intentions whose title overlaps the query keywords (V2 Upgrade 8
 * retrieval). Pure. */
export function matchIntentions(keywords: string[], intentions: Intention[]): Intention[] {
  if (keywords.length === 0) return [];
  return intentions.filter(
    (i) => i.status === 'open' && keywords.some((w) => i.title.toLowerCase().includes(w)),
  );
}

