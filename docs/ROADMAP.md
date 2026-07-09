# Nomi — Roadmap & Phase 1 Task Breakdown

**Status:** Phase 1 planned in detail; Phases 2–4 directional. July 2026.

Phase 1 target: **6–8 weeks to a Chrome Web Store submission.** Ordering principle: highest-risk assumptions first (MV3 lifecycle, widget injection), delight last (polish, copy).

---

## Phase 1 — Browser extension MVP

### Week 1 — Skeleton & riskiest assumptions ⚠️
- [x] WXT project scaffold: TypeScript, React, background worker, content script, popup. CI with typecheck + Vitest.
- [ ] **Spike A (gate):** event capture through worker restarts — visit start/end, tab switches, idle, all via event APIs + `chrome.storage.session`; kill the worker repeatedly and prove no sessions are lost or duplicated.
- [ ] **Spike B (gate):** Shadow DOM widget injected on heavy real sites (YouTube, GitHub, Gmail, LeetCode) — style isolation holds both ways, nothing blocked, no visible perf hit.
- [x] Event schema v1 + Dexie store + daily-rollup alarm.

**Gate:** both spikes pass → architecture confirmed. If either fails, stop and revisit ADR-2/ADR-6 before writing more code.

### Week 2 — Tracking engine
- [x] Session builder: raw events → visit sessions (domain, duration, category) handling tab switches, window blur, idle, sleep/wake.
- [x] Domain→category map for launch sites (LeetCode, GitHub, YouTube, LinkedIn, Spotify, Reddit, Netflix, Amazon, Stack Overflow, common docs).
- [x] Privacy layer: query-string/fragment stripping, sensitive-category blocklist, per-site exclusions, global pause. **Unit-tested; no event may bypass it.**
- [x] AES-GCM encryption of event payloads; retention alarm (7-day window + rollup compaction).

### Week 3 — Companion widget
- [x] Avatar: glass circle per DESIGN.md — breathing (4s cycle), blink, gaze-follows-mouse. CSS/transform only.
- [x] Drag to reposition; position persists. *(Still open: edge snapping; per-site auto-dodge if it covers fixed page UI.)*
- [x] States: idle / speaking (bubble) / paused (dimmed). *(Still open: has-something-to-say subtle glow.)*
- [x] Notification bubbles: floating glass, auto-dissolve, never stack more than one, click-to-dismiss teaches the rate limiter.

### Week 4 — Nudge engine
- [x] Rules engine over the event stream (pure functions, heavily unit-tested): focus streak ≥ 60/90 min · idle return · tab-switch storm (≥ N switches / 5 min) · hydration/break (time-based) · site-milestone from adapter signals · daily first-open greeting.
- [x] Guardrails: per-rule cooldowns, global cap (≤ 6 nudges/day default), quiet hours, "focus = silence" (no nudges during a deep-focus streak except its own gentle acknowledgment).
- [x] Message template system: multiple phrasings per rule, slot filling, no repeats within N days. Copy per DESIGN.md voice.

### Week 5 — Site adapters & daily memory
- [x] Adapter framework (whitelisted-signal contract per ADR-5) + LeetCode adapter (problem opened, submission accepted, difficulty) — the flagship.
- [ ] YouTube adapter (video title/channel) and GitHub adapter (repo activity) if time allows; otherwise Phase 1.1.
- [x] Daily rollup → template-based narrative summary ("Today felt productive…"), delivered as an evening bubble + stored.
- [x] Popup dashboard: today's story, simple timeline of the day, category time split.

### Week 6 — Chat & memory search
- [x] Chat panel attached to the widget (glass sheet).
- [x] Memory search without LLM: keyword + category + date parsing → timeline answers ("When did I last work on my portfolio?").
- [x] Ollama integration (optional, settings-gated): connection check, freeform chat with persona system prompt. Graceful copy when absent. *(Still open: LLM-polished daily summary.)*

### Weeks 7–8 — Trust, polish, ship
- [x] Onboarding: what Nomi sees / never sees / where data lives; permissions explainer; name greeting.
- [x] Settings: pause, exclusions, quiet hours, nudge frequency, data export (JSON), one-click wipe.
- [ ] Perf pass against ADR-6 budget; QA sweep on top-50 sites; accessibility (reduced-motion mode disables breathing/blink).
- [ ] Privacy policy + Web Store listing (single-purpose statement, screenshots) → **submit**.
- [ ] Landing page with waitlist (can proceed in parallel any week — independent workstream).

### Explicitly out of Phase 1 scope
Voice, camera/mood, desktop app, accounts/sync, gamification, personalities, plugins, Firefox/Edge, any backend.

---

## Phase 2 — Desktop & depth (directional)
Tauri desktop app (ADR-8): app-level awareness (VS Code, Spotify), OS keychain custody, bundled local model (removes the Ollama split). Voice (Whisper.cpp in, Piper out). Timeline replay UI. Embedding-based memory search (LanceDB + nomic-embed-text). Achievements/streaks/XP.

## Phase 3 — Personality & perception (directional)
Opt-in camera mood detection — local processing, no images ever written to disk. Downloadable personalities (Friend, Coach, Mom, Strict, Therapist…). Firefox/Edge. Weekly reflection reports.

## Phase 4 — Ecosystem (directional)
Opt-in E2E-encrypted multi-device sync (this is when accounts/backend arrive — ADR-7). Plugin marketplace (fitness, finance, mental health, career, reading). Study-group features. Mobile companion.

---

## Standing priorities (any phase)
1. Nothing ships that violates the privacy rules in ADR-5.
2. D7 widget-still-enabled retention is the north-star metric; nudge dismiss-rate is the health check.
3. When in doubt, Nomi says less. Silence is a feature.
