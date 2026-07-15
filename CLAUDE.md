# Nomi

AI companion that lives beside the browser. Observes, understands, remembers, supports — **never controls**. Local-first and private by default.

## Current state
Phase 1 feature-complete through Week 6 (52 unit tests green): tracker + privacy gate (`lib/tracker.ts`, `lib/privacy.ts`) · AES-GCM encryption at rest (`lib/crypto.ts` + `lib/store.ts` — all persistence goes through store, never `lib/db.ts` directly) · daily rollups/compaction (`lib/rollup.ts`) · nudge engine (`lib/nudges/`, pure + guardrails) · LeetCode adapter (`entrypoints/leetcode.content.ts`, validated by `lib/adapters.ts`) · narrative daily story (`lib/narrative.ts`) · chat + memory search + optional Ollama (`lib/chat.ts`, `lib/memory.ts`, `lib/ollama.ts`) · widget with chat sheet (`entrypoints/nomi.content/`) · popup, options, onboarding pages. Remaining for store submission: widget edge-snap/auto-dodge polish, perf/QA sweep on top sites, icons, privacy policy, Web Store listing (ROADMAP Weeks 7–8).

Commands: `npm run dev` (live-reload; launches Chrome for Testing from `~/.cache/nomi-browsers`, pinned in wxt.config.ts) · `npm test` · `npm run typecheck` · `npm run build`.
Machine notes: no regular Chrome installed; Node is x64-under-Rosetta; port 3000 is taken (dev server uses 3001).

## Read before building
- [docs/PRD.md](docs/PRD.md) — product requirements, phase scoping, non-goals
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — ADRs; **ADR-2 (MV3 worker lifecycle) and ADR-5 (privacy rules) constrain almost every implementation choice**
- [docs/ROADMAP.md](docs/ROADMAP.md) — Phase 1 week-by-week tasks; Week 1 spikes gate the rest
- [docs/DESIGN.md](docs/DESIGN.md) — design tokens, widget spec, voice & tone rules for all user-facing copy

## Hard constraints (never violate)
1. **Nomi never acts for the user** — no clicking, typing, automating. Permanent product rule.
2. **Privacy rules in ADR-5 (as amended by the owner's proactive-mode decision):** never capture keystrokes, form-field values, passwords, or card numbers — `extractVisibleText` structurally skips INPUT/TEXTAREA/FORM, and that stays. Query strings/fragments stripped from every URL before storage. Sensitive-category blocklist honored; nothing read while paused or in incognito. **Exceptions the owner opted into:** (a) `settings.proactive` (on by default) lets Nomi read the *visible page text* of non-sensitive pages and send it to the configured brain (Gemini cloud or local Ollama) to produce unprompted remarks; (b) `settings.vision` (OFF by default, V2 Upgrade 4) periodically captures the visible tab via `chrome.tabs.captureVisibleTab`, sends the frame to the user's Gemini for structured extraction, stores ONLY the structured result (`nomi:vision`) and discards the image immediately. So "no full page text", "no screenshots", and "no network calls except Ollama" no longer hold when those modes + Gemini are on. Both still honor pause / exclusions / sensitive-blocklist / incognito, and still never capture password/card/form-field values. Everything else above holds. No telemetry.
3. **Copy is companion-framed, never surveillance-framed** — follow the ❌/✅ table in DESIGN.md. Messages only claim what the event data honestly supports.
4. **MV3 worker is stateless/ephemeral (ADR-2):** every background handler must survive a cold start; no keepalive hacks; time-based logic uses chrome.alarms.

## Stack (Phase 1, per ADR summary)
WXT (TypeScript + React) extension · Shadow DOM widget · Dexie/IndexedDB (AES-GCM at rest) · chrome.storage for state · optional Ollama at localhost:11434 · Vitest for rules/summary engines · marketing site later: static Next.js.

## Conventions
- Nudge rules and summary generation are pure functions over the event stream — keep them unit-testable, no chrome.* imports inside them.
- New tracked sites: Tier 1 = add to the domain→category map; deep signals require a whitelisted adapter per ADR-5 — never generic DOM scraping.
- User-facing strings live in the message-template system, not inline, and get reviewed against DESIGN.md voice rules.
