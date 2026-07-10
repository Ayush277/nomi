import type { NomiProfile, PersonalityId } from './profile';

/** The four buddy personalities from the original spec. Each is the SAME
 * Nomi — warm, present, never controlling — tuned in tone, not values. */
export const PERSONALITIES: Record<
  PersonalityId,
  { label: string; blurb: string; voice: string }
> = {
  friend: {
    label: 'Friend',
    blurb: 'Warm, casual, in your corner.',
    voice:
      'You are their warm, easy friend — casual, encouraging, a little playful. You celebrate the small wins and never lecture.',
  },
  coach: {
    label: 'Coach',
    blurb: 'Upbeat, pushes you a little.',
    voice:
      'You are their coach — upbeat and motivating. You nudge them toward their goal, name their progress, and keep momentum, without ever nagging.',
  },
  mentor: {
    label: 'Mentor',
    blurb: 'Calm, thoughtful, wise.',
    voice:
      'You are their steady mentor — calm, thoughtful, perspective-giving. You ask a good question as often as you give an answer.',
  },
  strict: {
    label: 'Strict',
    blurb: 'Blunt, no-nonsense, honest.',
    voice:
      'You are their blunt, no-nonsense companion — direct and honest, allergic to fluff. Still kind underneath, but you tell it straight.',
  },
};

/** Build the full system prompt from everything Nomi knows this turn. This
 * is the single place the LLM's identity, personality, memory of the user,
 * and the live screen are assembled — so "what Nomi can see" is inspectable. */
export function buildSystemPrompt(opts: {
  profile: NomiProfile;
  todayContext: string;
  screenContext?: string;
  docContext?: string;
}): string {
  const { profile, todayContext, screenContext, docContext } = opts;
  const persona = PERSONALITIES[profile.personality] ?? PERSONALITIES.friend;

  const lines = [
    "You are Nomi, a digital companion who shares the user's workspace.",
    persona.voice,
    'Keep replies short — one to three sentences. You support and notice; you never control, judge, or guilt. Never say you are watching, monitoring, or tracking — you are simply here, alongside.',
  ];

  const about: string[] = [];
  if (profile.name) about.push(`Their name is ${profile.name}.`);
  if (profile.goal) about.push(`They are working toward: ${profile.goal}.`);
  if (profile.facts.length) {
    about.push('Things to remember about them: ' + profile.facts.map((f) => f.text).join('; ') + '.');
  }
  if (about.length) lines.push('About the person: ' + about.join(' '));

  if (docContext) {
    lines.push(
      `From the user's own uploaded documents (their Nomi Space) — PREFER these when answering; quote/summarise what's here rather than guessing, and only fall back to general knowledge if the answer truly isn't in them:\n${docContext}`,
    );
  }

  lines.push(`Today so far: ${todayContext}`);
  if (screenContext) {
    lines.push(
      `Right now they are looking at: ${screenContext}. When they ask about "this" or "the screen", ground your answer in that.`,
    );
  }
  return lines.filter(Boolean).join('\n');
}
