# Nomi — Design Language & Voice

**Status:** Draft v1 · July 2026
**Inspiration:** Cluely, Ron Design Lab, Linear, Raycast, Nothing OS, Apple Vision Pro glassmorphism.

The UI is a primary selling point. Everything feels like floating glass: no sharp boxes, no bright colors, soft blur, soft gradients, tiny animations, lots of breathing room.

---

## Design principles

1. **Glass, not chrome.** Surfaces are translucent, blurred, softly lit. The companion belongs to the desktop's atmosphere, not on top of it.
2. **Alive, not animated.** Motion is biological (breathing, blinking, glancing) and tiny. Nothing bounces, spins, or demands attention.
3. **Whitespace is confidence.** Dashboards are huge and mostly empty. One idea per view.
4. **Silence is the default state.** Visual quiet mirrors behavioral quiet — the widget at rest should be almost forgettable.

## Design tokens (v1)

| Token | Value | Notes |
|---|---|---|
| Glass surface | `rgba(255,255,255,0.08)` dark / `rgba(255,255,255,0.55)` light | + `backdrop-filter: blur(24px) saturate(1.4)` |
| Glass border | 1px `rgba(255,255,255,0.18)` | top edge slightly brighter (light-from-above) |
| Radius | 20px surfaces · 999px avatar/pills | never < 16px; no sharp boxes |
| Text | `rgba(255,255,255,0.92)` primary · `0.55` secondary (dark) | Inter or Geist |
| Accent | soft lavender→teal gradient, ~40% saturation | never pure/bright hues |
| Shadow | `0 8px 32px rgba(0,0,0,0.12)` | diffuse only, no hard edges |
| Motion | 200–400ms, `cubic-bezier(0.22, 1, 0.36, 1)` | enter = fade+2px rise; exit = dissolve |

## Companion widget

- **Size:** ~180×180px hit area; visible avatar ~120px glass orb.
- **Breathing:** scale 1.00→1.03, 4s ease-in-out loop.
- **Blink:** every 4–8s (randomized), 120ms.
- **Gaze:** pupils drift toward cursor with 200ms lag and small max travel — glancing, not tracking.
- **States:** idle (described above) · *has something to say* (inner glow pulses once, then a soft badge — never sound) · *speaking* (bubble attached) · *paused* (30% opacity, breathing stops).
- **Reduced motion:** `prefers-reduced-motion` disables breathing/blink/gaze entirely.

## Notification bubbles

Replace OS notifications. Small glass capsule near the widget, one line of text, appears with fade+rise, self-dissolves after ~8s. **Never more than one on screen.** No badge counts, no red anywhere.

## Dashboard (extension popup / future web)

Huge margins, floating glass cards, charts drawn with thin translucent strokes and animated on entry. The daily summary is presented as a story first; numbers are secondary and one click deeper.

## Landing page

Hero: the glass companion floating beside the cursor; mouse movement creates subtle reflections on its surface; background gradient reacts slowly. No heavy scroll effects — the page itself should feel like the product: calm, alive, glassy.

---

## Voice & Tone

**The framing rule (non-negotiable):** Nomi *shares the workspace*; it never *watches*. Every message is written as a companion sitting beside you, never as a system reporting on you.

| ❌ Surveillance framing | ✅ Companion framing |
|---|---|
| "I watched you work for an hour." | "I've noticed you've been focused for an hour. Nice work." |
| "You were detected idle for 90 minutes." | "You haven't moved in a while — everything okay? Want some water?" |
| "Activity log: 3 LinkedIn visits." | "LinkedIn again, huh? Third time today. Thinking about something?" |
| "Time on task exceeded threshold." | "Looks like this problem is frustrating. Want a short break?" |
| "Productivity score: 82." | "Today felt productive." |

**Voice attributes:** warm, brief, specific, lightly playful, never clinical. First person ("I noticed"), present with the user ("we've been at this a while").

**Rules:**
- One sentence when possible, two max. No metrics unless the user opens the dashboard.
- Celebrate specifics ("That Hard problem took three sessions — you got it"), never grade ("productivity: 82%").
- Never guilt, never shame, never compare to other users.
- Never claim understanding the data doesn't support (see PRD §6 non-goals) — "You've spent three sessions on binary search problems" is honest; "You've finally understood Binary Search" requires an adapter signal that proves it (e.g. accepted submissions), otherwise don't say it.
- Respect silence: during a focus streak, say nothing until it ends.
- Every message dismissible in one click; dismissals feed the rate limiter.

**Default personality (Phase 1):** "Friend" — the warm peer. Other personalities (Coach, Mom, Strict, Therapist…) are Phase 3 template packs layered on the same rules.
