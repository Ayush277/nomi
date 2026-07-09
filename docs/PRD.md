# Nomi — Product Requirements Document

**Status:** Draft v1 · July 2026
**Owner:** Ayush

---

## 1. One-liner

Nomi is an AI companion that lives beside your browser. It never clicks, never types, never takes control — it quietly shares your workspace, understands your habits, remembers your day, and speaks up only when it matters.

**Tagline candidates** (test on landing page):
- "Your digital companion that quietly understands your day."
- "Not another AI assistant. Just a companion."

## 2. Vision

Computers have become more intelligent, but they still don't feel personal. Nomi aims to be the first AI companion that genuinely grows with its user over months and years — helping people understand themselves better, not replacing their decisions.

## 3. Core philosophy

**Observe. Understand. Remember. Support. Never control.**

Non-negotiable product rules that fall out of this:

1. **Nomi never acts on the user's behalf.** No clicking, typing, automating, or intercepting. This is a permanent constraint, not a v1 limitation — it is the trust foundation.
2. **Companionship, not surveillance.** All copy and behavior is framed as *sharing the workspace*, never *watching the user*. See [DESIGN.md — Voice & Tone](DESIGN.md#voice--tone). Examples:
   - ✅ "I've noticed you've been focused for an hour. Nice work."
   - ❌ "I watched you work for an hour."
3. **Local-first, private by default.** All data stays on-device, encrypted at rest. No cloud recording, no hidden uploads, no telemetry by default. Sync (Phase 4) is opt-in and end-to-end encrypted.
4. **Present but never intrusive.** Silence is a feature. When the user is focused, Nomi says nothing. Nudges are rate-limited and always dismissible.

## 4. Positioning

| Product | Model |
|---|---|
| ChatGPT | Waits for prompts |
| Copilot | Writes code |
| Claude | Answers questions |
| **Nomi** | **Lives beside you and learns who you are** |

Nomi is *not* a productivity tracker, a time-tracking tool, or monitoring software. Its differentiation is emotional (companionship, memory, growth) and its moat is longitudinal: the longer you live with it, the more it knows you and the harder it is to leave.

## 5. Target user (Phase 1)

Students and early-career developers who spend their day across LeetCode, GitHub, VS Code (web docs), YouTube tutorials, and job platforms — people grinding toward a goal who want a sense of progress and a presence that notices it. Secondary: anyone doing long solo screen work.

## 6. Features by phase

### Phase 1 — Browser extension MVP (6–8 weeks)

| Feature | Requirement |
|---|---|
| **Companion widget** | Floating, transparent, ~180×180px glass avatar. Breathes, blinks, gaze follows mouse. Draggable; position remembered. Present on all normal web pages. |
| **Site awareness** | Tracks which sites are visited and for how long (domain + path only, query strings stripped). Category mapping for known sites (LeetCode, GitHub, YouTube, LinkedIn, Spotify, Reddit, Netflix, Amazon, Stack Overflow, docs sites). |
| **Site adapters** | Deep signals for 2–3 launch sites. LeetCode: problem opened / submission accepted / difficulty. YouTube: video title + watch category. GitHub: repo activity. Adapters read only whitelisted DOM signals — never full page content. |
| **Live nudges** | Rule-based observations: long focus streak, long inactivity, tab-switch storm, hydration/break reminders, wins ("Two hard problems today — that's progress"). Frequency-capped, cooldowns, quiet hours. |
| **Daily memory & summary** | Local event log → end-of-day narrative summary ("Today felt productive. You solved five LeetCode questions…"). Template-based; optional LLM polish if user runs Ollama. |
| **Text chat** | Chat panel in the widget. Memory-search queries work without an LLM ("When did I last work on my portfolio?"). Freeform conversation requires the optional Ollama connection. |
| **Privacy controls** | Pause button, per-site exclusion list, sensitive-category blocklist on by default (banking, health, adult), one-click data wipe, data export. Disabled in incognito. |
| **Local storage** | 7-day rolling memory on free tier. Encrypted at rest. |

**Phase 1 non-goals:** voice, camera/mood detection, desktop app, accounts, sync, gamification, personalities, plugins. Phase 1 messages must be honestly derivable from URL + timing + adapter signals — no claims about what the user "understood" beyond what adapters can actually detect.

### Phase 2 — Desktop & depth
Voice interaction (Whisper.cpp + Piper), desktop app (app-level awareness: VS Code, Spotify), timeline replay UI, AI memory search over embeddings, achievement system, bundled local LLM.

### Phase 3 — Personality & perception
Opt-in camera mood detection (stress/smile/focus/fatigue — processed locally, no images saved), downloadable personalities (Friend, Coach, Mom, Strict, Therapist, …), Firefox/Edge support, productivity insights.

### Phase 4 — Ecosystem
Optional E2E-encrypted multi-device sync, plugin marketplace (fitness, finance, mental health, career), study-group features, mobile companion.

## 7. Key experiences (Phase 1 walkthrough)

1. **Install** → 60-second onboarding: what Nomi sees, what it never sees, where data lives. Pick a name greeting. Widget appears.
2. **During the day** → widget sits in a corner, breathing. Occasionally a small glass bubble: "You've been on this LeetCode problem for 50 minutes. Stubborn one, huh?"
3. **A win** → LeetCode adapter sees an accepted submission on a Hard problem: "That one took you three sessions. You got it. 🎉"
4. **Evening** → "Today felt productive. You worked from 9:10 to 4:20, solved 5 problems, and took actual breaks for once."
5. **Anytime** → click the widget, ask "when did I last study graphs?" → timeline answer from local memory.

## 8. Success metrics (Phase 1)

- **D7 retention with widget still enabled** — the single most important number; an ambient product that gets disabled is dead.
- % of nudges reacted to positively vs. dismissed (target: <20% dismiss rate — if higher, we're too chatty).
- Daily summary open rate.
- Qualitative: do users describe Nomi as "it" or as a companion ("she noticed…") in feedback?

## 9. Pricing

| | Free | Pro |
|---|---|---|
| Memory | 7 days | Unlimited |
| Companion + browser tracking | ✅ | ✅ |
| Daily summary | ✅ | ✅ |
| Desktop app, voice, timeline replay | — | ✅ |
| Mood detection, custom personalities | — | ✅ |
| Cross-device sync (opt-in), plugins, advanced analytics | — | ✅ |

## 10. Risks

| Risk | Mitigation |
|---|---|
| "Creepy" perception kills adoption | Companionship framing everywhere; radical transparency in onboarding; local-first is a headline feature, not fine print. |
| MV3 service-worker lifecycle breaks "always present" | Architecture designed around it from day one — see [ARCHITECTURE.md ADR-2](ARCHITECTURE.md). |
| Nudges feel like fortune cookies | Phase 1 messages only claim what the data supports; adapters give real specificity; heavy rate limiting. |
| Local LLM onboarding cliff | Phase 1 works fully without any LLM; Ollama is an optional enhancement. See [ADR-4](ARCHITECTURE.md). |
| Chrome Web Store review (broad host permissions) | Clear privacy policy, single purpose statement, no remote code, justify `<all_urls>` with the widget. |
