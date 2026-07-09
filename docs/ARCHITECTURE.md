# Nomi — Architecture Decisions

**Status:** Accepted for Phase 1 · July 2026

Each ADR records a decision, the reasoning, and what would make us revisit it. Phase 1 scope only unless noted.

---

## ADR-1: Phase 1 ships as a Chrome Manifest V3 extension

**Decision:** Build Phase 1 as a Chrome MV3 extension using the [WXT](https://wxt.dev) framework (TypeScript + React + Vite + HMR, MV3-native, cross-browser later).

**Why:** Lowest-friction install for the target user; browser activity is where the Phase 1 signal lives; WXT removes most MV3 boilerplate pain and keeps a path to Firefox/Edge (Phase 3).

**Consequences / constraints to design around:**
- The widget cannot appear on `chrome://` pages, the Chrome Web Store, or other extension pages. Accepted.
- Requires `<all_urls>` host permission for the widget → stricter Web Store review. Mitigate with a clear single-purpose statement and privacy policy.
- Extensions are disabled in incognito by default; we additionally never track incognito even if the user enables it there.

**Revisit if:** Web Store rejects broad host permissions → fall back to opt-in per-site injection.

## ADR-2: Design around the MV3 service-worker lifecycle — no long-lived background state

**Decision:** The background service worker is treated as *stateless and ephemeral*. All state lives in storage; the worker is a pure event processor.

- Event capture uses only event-driven APIs: `tabs.onActivated`, `tabs.onUpdated`, `windows.onFocusChanged`, `idle.onStateChanged`, `webNavigation`.
- Time-based logic (session rollups, nudge cooldowns, end-of-day summary) runs off `chrome.alarms` (minimum 30s granularity — fine for our needs).
- Hot state (current session, widget mood) lives in `chrome.storage.session`; durable data in IndexedDB (ADR-3).
- Every handler must be correct when the worker cold-starts: read state → act → write state. No module-level mutable state that matters.

**Why:** MV3 kills the worker after ~30s idle. Fighting this (keepalive hacks) is fragile and a Web Store review risk. Embracing it is the only durable design. **This is the highest-risk assumption in the project — it is Week 1 of the roadmap specifically so it gets validated before anything is built on top.**

## ADR-3: Storage — IndexedDB via Dexie for events, chrome.storage for state

**Decision:**
- **Event log & summaries:** IndexedDB (Dexie) in the extension's background context. Handles the write volume and range queries (timeline, memory search) that `chrome.storage.local` can't.
- **Settings, nudge cooldowns, widget position:** `chrome.storage.local`; per-browser-session hot state in `chrome.storage.session`.
- **Encryption:** event payloads encrypted at rest with WebCrypto AES-GCM, key held in `chrome.storage.local`.
- **Retention:** rolling window enforced by a daily alarm (7 days free tier). Raw events compact into daily rollups before deletion so long-term memory survives as summaries.

**Honest caveat (documented, not hidden):** with the key on the same device in extension storage, encryption protects against casual inspection and disk scraping, not a determined local attacker. Real key custody arrives with the desktop app + OS keychain (Phase 2). Marketing must say "encrypted on your device", not "zero-knowledge".

**Event schema (v1):**
```ts
interface NomiEvent {
  id: string;            // ulid
  ts: number;            // epoch ms
  type: 'visit_start' | 'visit_end' | 'tab_switch'
      | 'idle_start' | 'idle_end' | 'site_signal';
  domain: string;        // "leetcode.com"
  path?: string;         // "/problems/two-sum" — query string & fragment ALWAYS stripped
  category: 'coding' | 'learning' | 'social' | 'entertainment'
          | 'shopping' | 'career' | 'music' | 'other';
  signal?: {             // site adapters only (ADR-5)
    adapter: string;     // "leetcode"
    kind: string;        // "submission_accepted"
    data: Record<string, string | number>;  // whitelisted fields only
  };
}
```

## ADR-4: Phase 1 works fully without an LLM; Ollama is an optional enhancement

**Decision:** Every Phase 1 feature must function with zero LLM:
- **Nudges:** rule engine over the event stream (thresholds + cooldowns), message templates with slots.
- **Daily summary:** template-based narrative generator over the day's rollup (varied phrasings so it doesn't feel canned).
- **Memory search:** keyword + category + date-range query over the event log.

If the user runs [Ollama](https://ollama.com) locally, Nomi upgrades: freeform chat, LLM-polished summaries, semantic memory search. Connection is `http://localhost:11434` from the background worker; requires host permission for localhost and the user setting `OLLAMA_ORIGINS` (onboarding walks through it). Recommended models: Llama 3.1 8B / Qwen 2.5 7B.

**Why:** An extension cannot run a 7B model; requiring Ollama at install is an onboarding cliff that would kill the funnel. Template quality is a writing problem, not a tech problem — see DESIGN.md. The desktop app (Phase 2) bundles a model properly and removes the split.

**Revisit if:** WebGPU in-browser small models (e.g. Gemma-class via MLC) become good enough for summary polish — worth a spike in Phase 2, not before.

## ADR-5: Two-tier site awareness — generic tracking + whitelisted site adapters

**Decision:**
- **Tier 1 (all sites):** domain, stripped path, timestamps, category from a bundled domain→category map. No page content, ever.
- **Tier 2 (adapters, launch set = LeetCode, YouTube, GitHub):** a per-site content script reads *specific, whitelisted DOM signals* and emits `site_signal` events. Examples: LeetCode `submission_accepted {slug, difficulty}`; YouTube `video_watch {title, channel}`; GitHub `commit_pushed {repo}`.

**Hard privacy rules (enforced in code review, stated in privacy policy):**
- Never keystrokes, never form fields, never message/DM content, never full page text.
- Query strings and URL fragments stripped before an event is created.
- Default-on blocklist: banking, healthcare, adult categories → no events at all.
- User-managed site exclusion list; global pause; nothing recorded while paused.

**Why:** Tier 1 alone can't support the magic moments in the PRD ("solved five LeetCode questions"); full-content reading violates the philosophy and would be right to distrust. Narrow adapters are the honest middle: deep where the user expects it, blind everywhere else.

## ADR-6: Widget renders in a Shadow DOM per tab; state syncs through storage

**Decision:** A content script on every page mounts the companion into a closed Shadow DOM (style isolation both directions), `position: fixed`, max z-index, `pointer-events` only on the avatar itself so it never blocks page interaction. React inside the shadow root. Animations (breathe/blink/gaze) are CSS + rAF, local to each tab — no cross-tab coordination needed for them. Shared state (mood, unread bubble, position) syncs via `chrome.storage.session` + `storage.onChanged`, so every tab's widget agrees within ~1 frame and survives worker restarts.

**Why:** Shadow DOM is the only reliable way to keep site CSS out of the widget and widget CSS out of the site. Storage-mediated state (vs. long-lived ports) is the pattern that survives MV3 worker death (ADR-2).

**Perf budget:** widget idle cost < 1% CPU, no layout thrash on host page (fixed overlay, transform-only animation), bundle injected per page < 150KB gzipped.

## ADR-7: No backend in Phase 1

**Decision:** No server, no accounts, no telemetry. The marketing site is static (Next.js on Vercel) with only a waitlist form. Pro licensing, when it arrives, starts as a license key check — accounts/Postgres/Prisma wait until sync (Phase 4) actually needs them.

**Why:** Every server component contradicts the local-first pitch and adds surface area we'd have to defend in the privacy policy. The spec's backend stack (Express/Postgres/Prisma/Redis) is *deferred*, not rejected.

## ADR-8: Desktop app (Phase 2) targets Tauri

**Decision:** When Phase 2 starts, build the desktop app in Tauri, not Electron, unless a spike finds a blocking gap (system-level idle/app tracking, tray, overlay windows — all exist in Tauri v2).

**Why:** The companion is a permanent resident on the user's machine; a ~10MB/low-RAM Tauri footprint fits "quiet companion" far better than a full Chromium instance. The web frontend carries over either way. Decision is cheap to revisit at Phase 2 kickoff; noted now so Phase 1 code avoids Electron-only assumptions.

---

## Phase 1 stack summary

| Layer | Choice |
|---|---|
| Extension framework | WXT (TypeScript, React 18, Vite) |
| Widget UI | React in Shadow DOM, Tailwind (shadow-scoped), Framer Motion |
| State | chrome.storage.session/local + Zustand in-tab |
| Event store | IndexedDB via Dexie, AES-GCM encrypted payloads |
| Scheduling | chrome.alarms |
| Optional LLM | Ollama over localhost (Llama 3.1 8B / Qwen 2.5 7B) |
| Marketing site | Next.js + Tailwind + Framer Motion, static on Vercel |
| Testing | Vitest (rules engine, summary generator), Playwright + CRX loading (smoke) |
