/** Every user-facing nudge string lives here, per CLAUDE.md conventions, so
 * the voice can be reviewed in one place against DESIGN.md: companion
 * framing only — "we/I noticed", never "detected/logged/tracked". Multiple
 * variants per rule so Nomi doesn't sound canned. */

export const NUDGE_TEMPLATES: Record<string, string[]> = {
  'leetcode-win-hard': [
    "A Hard one, accepted. That's the good stuff. 🎉",
    'You just cracked a Hard problem. Take a second to enjoy that.',
    "Hard problem down. I'd high-five you if I had hands.",
  ],
  'leetcode-win': [
    'Accepted! One more in the bag.',
    'That one gave in. Nice work.',
    'Solved. On to the next?',
  ],
  'focus-streak': [
    "You've been locked into {domain} for over an hour. Nice work.",
    'An hour straight on {domain}. Respect.',
    "I've noticed you've been deep in {domain} for a while now. Good rhythm.",
  ],
  'break-time': [
    "We've been at this almost two hours without a pause. Stretch a little?",
    'Two hours, no break. Your eyes could probably use a minute.',
    'Long stretch. Want to step away for five? It all stays right here.',
  ],
  'tab-storm': [
    'Lots of hopping around — looking for something specific?',
    "That's a lot of tabs in a short time. Anything I can help you find later?",
  ],
  'welcome-back': [
    'Welcome back. It was quiet without you.',
    "Hey, you're back. Picking up where we left off?",
  ],
  hydration: [
    "Water break? I'll hold your spot.",
    'Friendly reminder from your desk buddy: water exists.',
    "It's been a while since a pause. Maybe grab some water?",
  ],
  greeting: [
    'Morning. Here when you need me.',
    "Hey. I'm around if you need anything today.",
    "New day. Let's see where it goes.",
  ],
  'intention-ignored': [
    "Earlier you meant to {what} — still want to? No pressure.",
    "That thing you set aside — {what} — it's still on your list whenever you're ready.",
    'Circling back: you wanted to {what}. Might be a good moment.',
  ],
  stuck: [
    "You've been on this one about {minutes} minutes. Want to talk through the approach?",
    'Tough problem? I can be a rubber duck if it helps to think out loud.',
    "{minutes} minutes on this — a fresh angle sometimes shakes it loose. Want to try one?",
  ],
  'wellbeing-latenight': [
    "It's {clock} and you've been going a while — {reason}. Nothing's on fire; want to save your spot and pick it up fresh tomorrow?",
    "Late one — {clock}, {reason}. I'll keep everything right here if you want to rest and come back to it.",
    "{clock} already. You've put in the hours — {reason}. Bed might beat one more tab. I've got your place.",
  ],
  'wellbeing-break': [
    "You've been at it a good stretch — {reason}. A five-minute breather might do more than pushing through. I'll hold your place.",
    "{reason}. Maybe step away for a moment? It'll all be right here when you're back.",
    "Noticed {reason}. No rush — a quick pause, some water, then back to it?",
  ],
  'wellbeing-longday': [
    "That's a full day already — {reason}. You've earned a real pause. Want to wrap up on a good note?",
    "Solid day behind you — {reason}. No pressure to keep going; I'll remember where things are.",
    "{reason} today. That's plenty. Calling it here is a win, not a quit.",
  ],
};

export function fillTemplate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => slots[key] ?? '');
}

/** Rotate variants so the same rule never repeats its last phrasing. */
export function pickVariant(
  templateKey: string,
  lastVariant: Record<string, number>,
  slots: Record<string, string> = {},
): { text: string; variant: number } {
  const variants = NUDGE_TEMPLATES[templateKey] ?? [];
  if (variants.length === 0) return { text: '', variant: -1 };
  const last = lastVariant[templateKey] ?? -1;
  const variant = variants.length === 1 ? 0 : (last + 1) % variants.length;
  return { text: fillTemplate(variants[variant], slots), variant };
}
