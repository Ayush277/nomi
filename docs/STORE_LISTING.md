# Chrome Web Store Listing — Nomi

Draft for the developer-dashboard fields. Keep every claim consistent with PRIVACY.md and the code.

## Basics

- **Name:** Nomi — your quiet companion
- **Category:** Productivity → Workflow & Planning (alt: Fun)
- **Summary (≤132 chars):**
  `Not another AI assistant. A companion that lives beside your browser, notices your day, and remembers it — all on your device.`

## Description

```
Nomi is a little glass companion that lives in the corner of your browser.

It never clicks. It never types. It never takes control.

It just shares the workspace: it notices when you've been focused for an
hour, cheers when your LeetCode submission is finally accepted, suggests
water after a long stretch, and tells you the story of your day each
evening — "Today felt productive. We were at it from 9:10 to 4:20…"

Tap it to talk. Ask "how's today going?" or "when did I last work on my
portfolio?" and it answers from its local memory.

PRIVATE BY DESIGN
• Everything stays on your device, encrypted. No cloud, no account, no
  telemetry — the extension makes zero network requests.
• Banking, health, and mail sites are invisible to Nomi by default, and
  you can exclude any site.
• URLs are stored without query strings, where tokens and searches live.
• Pause anytime. Export everything. Erase everything (key included).
• Optional: connect a local Ollama model for freeform chat — still 100%
  on your machine.

QUIET BY DESIGN
• At most a handful of gentle notes a day (you choose how many).
• Quiet hours, per-rule cooldowns, and silence while you're in deep focus.
• Every note is one tap to dismiss — and Nomi learns to say less.

Nomi is for people who spend their days grinding toward something —
students, developers, job-hunters — and want someone in their corner who
notices the progress.
```

## Single-purpose statement

> Nomi displays an on-page companion that passively summarizes the user's own browsing rhythm (time per site, focus streaks, daily story) entirely on-device. All functionality serves this single companion purpose.

## Permission justifications

- **tabs** — Determine the active tab's domain and duration of attention; this is the product's core signal. No page content is read via this API.
- **storage** — Persist user settings and encrypted on-device memory.
- **idle** — Detect away/return so time away isn't misattributed and greetings are timely.
- **alarms** — Daily data retention/compaction and the evening summary; periodic rule evaluation.
- **Host access `<all_urls>`** — Injects the companion widget UI beside every page and (only on leetcode.com) reads one whitelisted DOM signal: the "Accepted" submission verdict. No other page content is accessed on any site.
- **Remote code:** none. **Data sold/transferred:** none. **Usage data collected by developer:** none.

## Privacy tab answers

- Collects personally identifiable info: **No** (data never leaves the device).
- Collects web history: technically stores the user's own site/time data **locally only**; nothing is transmitted. Disclose as "website content — no; web history — stored locally, never transmitted."
- Certification: does not sell/transfer user data, not used for unrelated purposes, not for creditworthiness.

## Assets needed before submit

- [ ] Screenshots 1280×800: widget on a docs page · chat sheet open · popup story · settings · onboarding.
- [ ] Small promo tile 440×280 (orb on gradient), marquee 1400×560 optional.
- [ ] Privacy policy hosted at a public URL (use PRIVACY.md on the landing page or GitHub Pages).
- [ ] Version bump + `npm run zip` for the upload artifact.
