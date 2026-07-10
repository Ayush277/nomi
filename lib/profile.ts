/** Who the user IS — the layer that turns an activity tracker into a buddy.
 * Small and sync-friendly, so it lives in chrome.storage.local (not the
 * encrypted event DB): the widget, background, and options all read it. */

export type PersonalityId = 'friend' | 'coach' | 'mentor' | 'strict';

export interface UserFact {
  id: string;
  text: string;
  ts: number;
}

export interface NomiProfile {
  name: string;
  personality: PersonalityId;
  /** Free-text goal the user is working toward. */
  goal: string;
  /** Discrete things Nomi should remember ("prepping for FAANG", "cat named Miso"). */
  facts: UserFact[];
  /** True once the guided first-run has been completed. */
  onboarded: boolean;
}

export const PROFILE_KEY = 'nomi:profile';

export const DEFAULT_PROFILE: NomiProfile = {
  name: '',
  personality: 'friend',
  goal: '',
  facts: [],
  onboarded: false,
};

export async function getProfile(): Promise<NomiProfile> {
  const stored = await chrome.storage.local.get(PROFILE_KEY);
  return { ...DEFAULT_PROFILE, ...(stored[PROFILE_KEY] ?? {}) };
}

export async function saveProfile(profile: NomiProfile): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}

export async function addFact(text: string): Promise<UserFact> {
  const clean = text.trim().replace(/\s+/g, ' ').slice(0, 200);
  const profile = await getProfile();
  const fact: UserFact = { id: crypto.randomUUID(), text: clean, ts: Date.now() };
  // De-dupe near-identical facts so "remember X" twice doesn't pile up.
  const exists = profile.facts.some((f) => f.text.toLowerCase() === clean.toLowerCase());
  if (!exists) {
    profile.facts = [...profile.facts, fact].slice(-40); // keep the most recent 40
    await saveProfile(profile);
  }
  return fact;
}

export async function removeFact(id: string): Promise<void> {
  const profile = await getProfile();
  profile.facts = profile.facts.filter((f) => f.id !== id);
  await saveProfile(profile);
}

/** Pull an explicit "remember ..." instruction out of a message. */
export function parseRemember(text: string): string | null {
  const m = text.match(
    /^(?:nomi[,\s]+)?(?:please\s+)?remember(?:\s+that)?(?:\s+i(?:'m| am)?)?\s*[:,]?\s*(.+)/i,
  );
  if (!m) return null;
  const fact = m[1].trim();
  // "remember to call mom" is a reminder, not a fact about the user.
  if (/^to\b/i.test(fact)) return null;
  return fact.length > 1 ? fact : null;
}

/** Notice the user stating their name in passing, e.g. "i'm Ayush". */
export function parseName(text: string): string | null {
  const m = text.match(/\b(?:i'm|i am|my name is|call me|it's|this is)\s+([A-Z][a-zA-Z'-]{1,20})\b/);
  if (!m) return null;
  const name = m[1];
  // Filter obvious non-names that follow "I'm ..." (feelings, states).
  const notNames = /^(fine|good|great|okay|ok|tired|busy|here|back|done|sorry|sure|going|trying|working|not|so|really|just|still|also)$/i;
  return notNames.test(name) ? null : name;
}
