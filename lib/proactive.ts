/** Proactive engine — the "buddy that reacts on its own" (opt-in, set by the
 * user). Every nudge tick Nomi can glance at the visible page and decide
 * whether a short, unprompted remark is worth making. PURE logic only (no
 * chrome.*, no model calls) so the gating and parsing stay unit-testable —
 * the background does the I/O and calls the model.
 *
 * Design guards so it stays a buddy and not a chatterbox:
 *  - cooldown between remarks (never more than one every few minutes),
 *  - only speaks when the context actually CHANGED (new page/heading),
 *  - the model is told it may stay silent, and silence is the default. */

export interface ProactiveState {
  lastReactTs: number;
  lastKey: string;
}

export const EMPTY_PROACTIVE_STATE: ProactiveState = { lastReactTs: 0, lastKey: '' };

export const PROACTIVE_COOLDOWN_MS = 4 * 60000;
const MIN_TEXT_LEN = 40; // below this the page has nothing worth reacting to
const SILENT = 'PASS'; // sentinel the model returns when it has nothing to add

/** A stable fingerprint of what the user is looking at, so we react to a new
 * context but not to the same page sitting there. Label already carries the
 * domain + heading/path; we just normalize it. */
export function screenKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Should we even ask the model right now? Gate on cooldown + a changed
 * context + enough on-screen text to be worth a remark. */
export function shouldReact(
  state: ProactiveState,
  now: number,
  screen: { label: string; text: string },
): boolean {
  if (screen.text.trim().length < MIN_TEXT_LEN) return false;
  if (now - state.lastReactTs < PROACTIVE_COOLDOWN_MS) return false;
  return screenKey(screen.label) !== state.lastKey;
}

/** The instruction handed to the model. Kept deliberately reluctant — a good
 * buddy mostly stays quiet and only chimes in when it genuinely helps. */
export function proactivePrompt(): string {
  return [
    'You can see what your human is looking at right now (given in the system context).',
    'If — and only if — there is something genuinely useful, encouraging, or timely to say about it,',
    'say it in ONE short, warm sentence, like a friend glancing over their shoulder.',
    `Otherwise reply with exactly "${SILENT}" and nothing else.`,
    'Do not narrate that you are watching. Do not summarize the page back to them.',
    'Stay silent (PASS) for logins, checkout, anything private, or anything unremarkable.',
  ].join(' ');
}

/** Turn the model's raw reply into a remark to show, or null to stay quiet. */
export function parseReaction(raw: string): string | null {
  const t = raw.trim().replace(/^["']|["']$/g, '').trim();
  if (!t) return null;
  if (t.toUpperCase() === SILENT) return null;
  // A model that ignored the PASS instruction and rambled doesn't get to speak.
  if (t.length > 240) return null;
  // Guard against the model announcing surveillance despite the persona rules.
  if (/\b(watching|monitoring|tracking|surveil)/i.test(t)) return null;
  return t;
}

/** Advance state after we (attempted to) react, so the cooldown/context gate
 * holds regardless of whether the model actually spoke. */
export function markReacted(now: number, label: string): ProactiveState {
  return { lastReactTs: now, lastKey: screenKey(label) };
}
