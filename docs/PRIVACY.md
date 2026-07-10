# Nomi Privacy Policy

**Effective:** July 2026 · applies to the Nomi browser extension v0.1.x

Nomi is a companion, not a tracker. This policy is written to be read, and it matches the code — every claim below is enforced in the extension's privacy gate and covered by its test suite.

## The short version

Everything Nomi remembers stays on your device, encrypted. Nothing is sent to us — there is no "us" server to send it to. No accounts, no analytics, no telemetry, no ads, no selling data, ever.

## What Nomi notices

- **Which sites you spend time on and for how long** — the domain (e.g. `leetcode.com`), the page path (e.g. `/problems/two-sum`), and timestamps. **Query strings and URL fragments are always stripped before anything is stored**, because that's where search terms, tokens, and email addresses live.
- **Rhythm signals** — tab switches and idle/active transitions (no content, just timing).
- **A small whitelisted set of site events** — currently one: when LeetCode shows an accepted submission, Nomi records the problem name and difficulty so it can celebrate with you. Every such signal is validated against a strict allowlist; anything else an adapter tries to send is dropped.

## What Nomi never touches

- Keystrokes, form fields, passwords, clipboard.
- Message or email content, page text, screenshots.
- Anything in incognito windows.
- Banking, healthcare, and mail sites — blocked by a built-in list, and you can add any site to your own exclusion list in Settings.
- Anything while paused. Pause means nothing is recorded, full stop.

## Where your data lives

On your device, in the browser's local extension storage, encrypted at rest with AES-256-GCM. Raw detail is kept for **7 days**, then compacted into small daily summaries. "Erase everything" in Settings deletes all data **and the encryption key**.

Honest caveat: the encryption key also lives on your device, so this protects against casual inspection of disk files — it is not a defense against someone with full control of your machine and profile.

## Network access

The extension makes **no network requests by default**. Two opt-in exceptions, both off until you enable them in Settings:

1. **Local AI (Ollama)** — Nomi talks to an Ollama server at `http://localhost:11434`, software running on your own machine. That traffic never leaves your computer.
2. **Cloud AI (Gemini)** — if you paste your own Google API key and switch it on, your **chat messages** (plus a one-line summary of today) are sent to Google's Gemini API to generate replies. Nothing else is ever sent: not your browsing history, not your memory, not your events. Settings states this in plain words next to the toggle, and turning it off stops all cloud traffic immediately.
3. **Free fallback chat (pollinations.ai)** — when enabled and no other chat brain can answer, your **chat messages** (and the same one-line today summary) go to the keyless pollinations.ai service. Same scope as above: chat only, never browsing data or memory. One toggle in Settings turns it off.
4. **Voice input (Gemini transcription)** — when you tap the mic and speak, the recorded clip is sent to Google's Gemini API (using your key) to turn it into text, which then flows through chat like any typed message. The microphone is only active while you are actively speaking to Nomi; clips are never stored. This is off unless you grant the microphone and use it.

## Permissions, and why

| Permission | Why Nomi needs it |
|---|---|
| `tabs` | To know which site is active and for how long — the core of the companion. |
| `storage` | To keep settings and encrypted memory on your device. |
| `idle` | To notice when you step away, so time away isn't counted and it can say "welcome back." |
| `alarms` | To run its once-a-day tidy-up and the evening summary. |
| Access to all sites (`<all_urls>`) | So the companion widget can appear beside any page you browse. It reads nothing from pages except the whitelisted LeetCode signal above. |

## Your controls

Pause anytime (popup) · exclude any site (Settings) · export everything as JSON (Settings) · erase everything including the key (Settings).

## Changes & contact

If this policy ever changes, the extension's update notes will say so in plain language. Questions: prince908ayush@gmail.com
