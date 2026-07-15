import { runAgent, type AgentTool } from './agent';
import { clearBag, getLinks, isRecallLinks, isRemoveLink, isSaveLink, removeLink, saveLink, searchLinks } from './bag';
import { addLinkedTool, describeConnections, getConnections, resolveTool } from './connect';
import { buildContextSnapshot, describeContext } from './context';
import { describeBrief, loadCompanionBrief } from './dashboard';
import { freeChat } from './freechat';
import { geminiChat } from './gemini';
import { getDocs } from './docs';
import { memoryPassages, ragSearchDocs, ragSearchMemory } from './rag';
import { autodocTold, getAutodoc } from './autodoc';
import { describeOpenLoop, findOpenLoop } from './buddy';
import { addIntention, getOpenIntentions, matchIntentions, parseIntent, resolveIntention } from './intents';
import { describeLearned, EMPTY_LEARNED } from './learning';
import { addProject, getProjects, inferProject, parseProjectCommand } from './projects';
import { describeVision, type VisionSnapshot } from './vision';
import { countEntries, getJournal, isCountQuery, logEntry, parseLog } from './journal';
import { isMemoryQuery, searchMemory } from './memory';
import { observableUrl } from './privacy';
import { confirmSiteReminder, parseSiteReminder } from './smartreminders';
import { narrate } from './narrative';
import { ollamaChat } from './ollama';
import { buildSystemPrompt, PERSONALITIES } from './persona';
import { addFact, getProfile, parseName, parseRemember, removeFact, saveProfile } from './profile';
import { confirmText, extractDelay, parseReminder, spokenDelay } from './reminders';
import { calc, tryUtility } from './utilities';
import { getSettings } from './settings';
import { allRollups, eventsSince, sessionsSince } from './store';
import { startOfDay } from './time';
import { todayLine, todayRollup } from './summary';
import type { ChatMessage } from './types';

/** Background-side chat brain (ADR-4): intent handlers work with no LLM;
 * freeform conversation upgrades in when the user has Ollama running. */

const NO_LLM_FALLBACK =
  'For open conversation, connect a brain in Settings — a Gemini API key (easiest) or local Ollama (fully private). Meanwhile, try: "how\'s today going?" · "when did I last open leetcode?" · "remind me to stretch in 20 minutes".';

const OLLAMA_ERROR_FALLBACK =
  "I couldn't reach the local model just now — is Ollama running? I can still do \"how's today going?\" and \"when did I last…\" from memory.";

const GEMINI_ERROR_FALLBACK =
  "I couldn't reach Gemini just now — worth checking the API key in Settings. Memory, today's story, and reminders all still work.";

/** Evening-story polish (roadmap Week 6): the template story is the source
 * of truth; a local model may only rephrase it. Any failure → template wins. */
export async function polishStory(story: string): Promise<string> {
  const settings = await getSettings();
  if (!settings.ollama.enabled) return story;
  try {
    const polished = await ollamaChat({
      model: settings.ollama.model,
      system: buildSystemPrompt({ profile: await getProfile(), todayContext: story }),
      messages: [
        {
          role: 'user',
          content: `Retell this evening note to your human in your own voice. Keep every fact, number, and time exactly as given; 2–3 sentences; no preamble:\n\n${story}`,
        },
      ],
    });
    // A model that rambles or drops content doesn't get to speak.
    return polished.length > 20 && polished.length < story.length * 3 ? polished : story;
  } catch {
    return story;
  }
}

/** The live-context block (V2 Phase A): the assembled Context Engine snapshot
 * plus the Companion Brief, rendered for the system prompt. Best-effort — any
 * failure just means a slightly less situated reply, never a broken one. */
export async function liveContextBlock(now = Date.now()): Promise<string | undefined> {
  try {
    const recent = await eventsSince(now - 30 * 60000);
    const [ctx, brief, profile] = await Promise.all([
      buildContextSnapshot(recent, now),
      loadCompanionBrief(now),
      getProfile(),
    ]);
    const learned = profile.learned ? describeLearned(profile.learned) : null;
    // Vision snapshot (opt-in), only if fresh enough to still describe the screen.
    const { 'nomi:vision': vision } = await chrome.storage.session.get('nomi:vision');
    const visionLine =
      vision && now - ((vision as VisionSnapshot).capturedTs ?? 0) < 5 * 60000
        ? describeVision(vision as VisionSnapshot)
        : null;
    const block = [describeContext(ctx), describeBrief(brief), learned, visionLine]
      .filter(Boolean)
      .join('\n');
    return block || undefined;
  } catch {
    return undefined;
  }
}

/** "No, in 30 minutes" — the user is correcting the time on the reminder they
 * just set. Retime the freshest pending one instead of inventing a new timer.
 * Only fresh reminders (15 min) qualify, so an old pending reminder never gets
 * hijacked by an unrelated sentence. Returns the confirmation, or null. */
async function retimeLatestReminder(q: string, now: number): Promise<string | null> {
  const delayMs = extractDelay(q);
  if (delayMs === null) return null;
  const { 'nomi:reminders': rem } = await chrome.storage.local.get('nomi:reminders');
  if (!rem) return null;
  const pending = Object.entries(
    rem as Record<string, { what?: string; at?: number; createdTs?: number }>,
  ).filter(([, r]) => r && typeof r === 'object' && (r.at ?? 0) > now);
  if (pending.length === 0) return null;
  pending.sort((a, b) => (b[1].createdTs ?? b[1].at ?? 0) - (a[1].createdTs ?? a[1].at ?? 0));
  const [id, r] = pending[0];
  if (r.createdTs && now - r.createdTs > 15 * 60000) return null; // not fresh — not a correction
  r.at = now + delayMs;
  await chrome.storage.local.set({ 'nomi:reminders': rem });
  await chrome.alarms.clear(`nomi:reminder:${id}`);
  chrome.alarms.create(`nomi:reminder:${id}`, { when: r.at });
  return `Fixed — "${r.what}" ${spokenDelay(delayMs)}.`;
}

const STOP = new Set(['what', 'when', 'where', 'which', 'about', 'with', 'that', 'this', 'have', 'been', 'your', 'mine', 'they', 'them', 'from', 'into', 'tell', 'know', 'said']);

/** Retrieval for the freeform path (V2 Upgrade 8): pull the intentions, projects
 * and remembered facts that overlap what the user just asked, so the model
 * answers from memory instead of guessing. Best-effort, returns a short block. */
export async function retrieveForPrompt(query: string, facts: string[]): Promise<string | undefined> {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  if (words.length === 0) return undefined;
  try {
    const hits: string[] = [];
    for (const i of matchIntentions(words, await getOpenIntentions()).slice(0, 3)) {
      hits.push(`an open intention: "${i.title}"`);
    }
    for (const p of await getProjects()) {
      if (words.some((w) => p.name.toLowerCase().includes(w))) hits.push(`their project "${p.name}"`);
    }
    for (const f of facts) {
      if (words.some((w) => f.toLowerCase().includes(w))) hits.push(`you know: ${f}`);
    }
    return hits.length
      ? `Relevant to their question from what you already know (use it): ${[...new Set(hits)].slice(0, 4).join('; ')}.`
      : undefined;
  } catch {
    return undefined;
  }
}

/** Proactive remark: given what's currently on screen, ask the brain whether
 * there's a short, buddy-like thing worth saying — or nothing. Returns the raw
 * model text (the caller parses PASS/limits via lib/proactive). Null when no
 * brain is configured or the call fails — proactivity is best-effort, never
 * blocks and never surfaces an error to the user. */
export async function proactiveComment(
  screenContext: string,
  instruction: string,
): Promise<string | null> {
  const settings = await getSettings();
  if (settings.paused) return null;
  const system = buildSystemPrompt({
    profile: await getProfile(),
    todayContext: await todayLine().catch(() => 'a normal day'),
    screenContext,
    liveContext: await liveContextBlock(),
    language: settings.language,
  });
  const messages = [{ role: 'user' as const, content: instruction }];
  try {
    if (settings.gemini.apiKey.trim()) {
      return await geminiChat({
        apiKey: settings.gemini.apiKey.trim(),
        model: settings.gemini.model,
        system,
        messages,
      });
    }
    if (settings.ollama.enabled) {
      return await ollamaChat({ model: settings.ollama.model, system, messages });
    }
  } catch {
    return null;
  }
  return null;
}

/** The page the user is chatting from, sent by the widget with each message —
 * so page-bound actions (save this link) never depend on focus-order queries. */
export interface PageRef {
  url?: string;
  title?: string;
}

export async function chatRespond(
  text: string,
  history: ChatMessage[],
  screenContext?: string,
  page?: PageRef,
): Promise<string> {
  const reply = await respondOnce(text, history, screenContext, page);
  const lastNomi = [...history].reverse().find((m) => m.role === 'nomi')?.text?.trim();
  if (!lastNomi || reply.trim() !== lastNomi) return reply;
  // Nomi was about to say the EXACT same thing twice in a row. Asking again
  // means the first answer didn't land — repeating it verbatim is the fastest
  // way to make a person feel unheard. Re-answer from ground truth instead.
  return reAnswer(text, history, reply, screenContext);
}

/** Second attempt when the canned reply would repeat: hand the model the hard
 * facts (bag, reminders, docs) plus the failed reply, and demand a different,
 * more concrete answer. Falls back to an honest self-aware line with no LLM. */
async function reAnswer(
  q: string,
  history: ChatMessage[],
  failed: string,
  screenContext?: string,
): Promise<string> {
  try {
    const settings = await getSettings();
    const capable =
      (settings.gemini.enabled && settings.gemini.apiKey.trim()) || settings.ollama.enabled || settings.freeChat;
    if (capable) {
      const [links, docs, profile] = await Promise.all([getLinks(), getDocs(), getProfile()]);
      const { 'nomi:reminders': held } = await chrome.storage.local.get('nomi:reminders');
      const pending = Object.values((held ?? {}) as Record<string, { what?: string; at?: number }>).filter(
        (r) => typeof r === 'object' && (r.at ?? 0) > Date.now(),
      );
      const truth = [
        `Their bag holds ${links.length} link${links.length === 1 ? '' : 's'}${
          links.length ? ': ' + links.slice(-8).map((l) => `"${l.title}" (${l.domain})`).join('; ') : ''
        }.`,
        `${pending.length} reminder${pending.length === 1 ? '' : 's'} pending.`,
        `${docs.length} document${docs.length === 1 ? '' : 's'} in their Nomi Space.`,
      ].join(' ');
      const docHits = await ragSearchDocs(q, docs, 5);
      const system =
        buildSystemPrompt({
          profile,
          todayContext: await todayLine().catch(() => 'a normal day'),
          screenContext,
          docContext: docHits.length
            ? docHits.map((h) => `[${h.docName}] ${h.passage}`).join('\n---\n')
            : undefined,
          liveContext: await liveContextBlock(),
          language: settings.language,
        }) +
        `\n\nGROUND TRUTH RIGHT NOW (trust this over everything): ${truth}` +
        `\n\nIMPORTANT: You already answered "${failed}" and they asked again — it did NOT satisfy them. Do not repeat or paraphrase it. Answer their exact question from the ground truth above. If the data genuinely shows nothing, say precisely what you checked and what would make it work — never the same canned line again.`;
      const messages = [
        ...history.slice(-6).map((m) => ({
          role: m.role === 'nomi' ? ('assistant' as const) : ('user' as const),
          content: m.text,
        })),
        { role: 'user' as const, content: q },
      ];
      return await askModel(system, messages, settings);
    }
  } catch {
    /* fall through to the honest line */
  }
  return `I know I just said this, and hearing it twice is annoying — but it's genuinely what I see: ${failed} If something's missing, tell me what you expected and I'll dig from there.`;
}

async function respondOnce(
  text: string,
  history: ChatMessage[],
  screenContext?: string,
  page?: PageRef,
): Promise<string> {
  let q = text.trim();
  const now = Date.now();

  // "Hey Nomi, …" works everywhere — strip the wake phrase, then listen.
  const wakePrefix =
    q.match(/^(?:hey|hi|ok|yo|hello)[,!\s]+nomi[,!.\s]*/i) ?? q.match(/^nomi[,!.\s]+/i);
  if (wakePrefix) q = q.slice(wakePrefix[0].length).trim();
  if (wakePrefix && !q) return "Hey — I'm listening. What do you need?";

  // Instant utilities (offline, no model): math, %, unit/timezone, days-until.
  const util = tryUtility(q, now);
  if (util) return util;

  // Timer: "set a timer for 25 minutes" / "10 minute timer". Reuses the
  // reminder + alarm machinery, just with timer-flavoured text.
  const timer = q.match(/\b(?:set (?:a )?)?timer\b|\btimer\s+for\b|\b\d+\s*(?:min(?:ute)?s?|hours?|hrs?|secs?|seconds?)\s+timer\b/i);
  if (timer) {
    // "for 10 minutes" → "in 10 minutes"; "10 minute timer" → "in 10 minute …".
    const delayMs = extractDelay(q.replace(/\bfor\b/gi, 'in')) ?? extractDelay(`in ${q}`);
    if (delayMs) {
      const id = crypto.randomUUID();
      const { 'nomi:reminders': reminders } = await chrome.storage.local.get('nomi:reminders');
      const label = `${spokenDelay(delayMs).replace(/^in /, '')} timer`;
      await chrome.storage.local.set({
        'nomi:reminders': { ...(reminders ?? {}), [id]: { what: `⏲️ ${label} — time's up`, at: now + delayMs, createdTs: now } },
      });
      chrome.alarms.create(`nomi:reminder:${id}`, { when: now + delayMs });
      return `Timer set — ${spokenDelay(delayMs).replace(/^in /, '')}. I'll ping you.`;
    }
    return 'How long should the timer run? Try "set a timer for 10 minutes".';
  }

  // "what are my reminders?" — show everything currently held.
  if (/\b(what|list|show|any|see|check)\b.*\breminders?\b|^my reminders/i.test(q) && !parseReminder(q)) {
    const { 'nomi:reminders': held } = await chrome.storage.local.get('nomi:reminders');
    const upcoming = Object.values((held ?? {}) as Record<string, { what?: string; at?: number }>)
      .filter((r) => typeof r === 'object' && r.at && r.at > now)
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    if (upcoming.length === 0) {
      return 'Nothing pending right now. Hand me one — "remind me to stretch in 20 minutes".';
    }
    return (
      'Holding: ' +
      upcoming
        .map((r) => {
          const m = Math.max(1, Math.round(((r.at ?? now) - now) / 60000));
          return `"${r.what}" in ${m} minute${m === 1 ? '' : 's'}`;
        })
        .join(' · ') +
      '.'
    );
  }

  // "how many jobs did I apply to?" — count from the activity journal.
  if (isCountQuery(q)) {
    const { count, matched, window } = countEntries(q, await getJournal(), now);
    if (count === 0) {
      return "I don't have any of those logged yet. Tell me things like \"I applied to a job\" and I'll keep count.";
    }
    const when = window === 'ever' ? '' : ` ${window}`;
    const recent = matched
      .slice(-3)
      .reverse()
      .map((e) => `• ${e.text}`)
      .join('\n');
    return `${count}${when}. Most recent:\n${recent}`;
  }

  // "I applied to a job" / "log that I finished X" — record it, don't turn it
  // into a timer. This is the fix for reminders misfiring on statements.
  if (!/\bremind me\b/i.test(q) && !isSaveLink(q)) {
    const logged = parseLog(q);
    if (logged) {
      await logEntry(logged);
      void autodocTold(logged); // it also lands in the living document
      return `Logged: "${logged}". Ask me "how many…" anytime and I'll count them.`;
    }
  }

  // Remove from the bag — "delete the link about X", "clear my bag". Checked
  // before save so "remove" never gets treated as a save.
  if (isRemoveLink(q)) {
    if (/\b(clear|empty|wipe|delete all|remove all)\b.*\bbag\b|\b(clear|empty|wipe)\s+(my\s+)?bag\b/i.test(q)) {
      const n = (await getLinks()).length;
      await clearBag();
      return n ? `Cleared your bag — removed all ${n} saved link${n === 1 ? '' : 's'}.` : 'Your bag was already empty.';
    }
    const links = await getLinks();
    if (links.length === 0) return "Your bag is empty — nothing to remove.";
    const hits = searchLinks(q, links);
    if (hits.length === 0) {
      return "I couldn't find a saved link matching that. Ask \"what did I save?\" to see them, then tell me which to remove.";
    }
    await removeLink(hits[0].id);
    return `Removed "${hits[0].title}" from your bag.${hits.length > 1 ? ` (${hits.length - 1} other match${hits.length === 2 ? '' : 'es'} left — name it more specifically if that was the wrong one.)` : ''}`;
  }

  // Personal Bag — "save this", "keep it in the bag/memory". Handled before
  // reminders so it never gets mistaken for a timer. The page comes WITH the
  // message (the widget knows where it lives); the focused-tab query is only
  // a fallback for the voice path, which has no page attached.
  if (isSaveLink(q)) {
    let url = page?.url;
    let title = page?.title;
    if (!url) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      url = tab?.url;
      title = tab?.title ?? undefined;
    }
    const clean = url ? observableUrl(url) : null;
    if (!url || !clean) return "I can't save this page — it's a private or browser page.";
    const saved = await saveLink({
      url: url.split('#')[0],
      title: (title || clean.domain).slice(0, 160),
      domain: clean.domain,
    });
    // Read the bag back so the confirmation states verified truth, not hope.
    const count = (await getLinks()).length;
    return `Kept it — [${saved.title}](${saved.url}). That's ${count} in your bag now; ask "what did I save?" anytime.`;
  }

  // "I'm working on X" / "call this project X" — name the current project so
  // Nomi can say "you're working on X" instead of "you're on github.com".
  if (!/\bremind me\b/i.test(q)) {
    const projectName = parseProjectCommand(q);
    if (projectName) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const domain = tab?.url ? observableUrl(tab.url)?.domain : undefined;
      const p = await addProject(projectName, domain ? [domain] : []);
      return `Got it — I'll treat this as your "${p.name}" project${domain ? ` (starting with ${domain})` : ''}.`;
    }
  }

  // Intent Engine (V2): "I should reply", "I'll read this later", "note to
  // self: …" — store as an unfinished intention, not a timer. Placed after
  // reminders/bag/journal so it only catches what they don't.
  if (!/\bremind me\b/i.test(q)) {
    const intent = parseIntent(q);
    if (intent) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const domain = tab?.url ? observableUrl(tab.url)?.domain : undefined;
      const relatedProject = domain
        ? inferProject({ domain }, await getProjects())
        : null;
      await addIntention(intent, { domain, relatedProject });
      const tail = relatedProject ? ` (${relatedProject})` : '';
      return `Noted — I'll keep "${intent.title}"${tail} on your open list. Ask "what am I putting off?" anytime.`;
    }
  }

  // Intent recall — "what am I putting off / what's unfinished / my intentions".
  if (/\bwhat('?s| is| am i)\b.*\b(unfinished|putting off|pending|left to do|forgetting)\b|\bmy (intentions?|to-?dos?|open (list|items?|loops?))\b|\bwhat (do i|should i|to) (need to |get back to )?(do|finish)\b/i.test(q)) {
    const open = await getOpenIntentions();
    if (open.length === 0) {
      return "Nothing on your open list yet. When you say things like \"I should reply to this\" or \"I'll read this later\", I'll hold onto them.";
    }
    return (
      'Still open:\n' +
      open
        .slice(0, 6)
        .map((i) => {
          const proj = i.relatedProject ? ` — ${i.relatedProject}` : '';
          const pr = i.priority === 'high' ? ' ⚑' : '';
          return `• ${i.title}${proj}${pr}`;
        })
        .join('\n')
    );
  }

  // Linked tools — "link/connect my Notion", "open my Obsidian / calendar".
  const linkCmd = q.match(/\b(?:link|connect|hook up)\s+(?:my\s+|to\s+)?([a-z][a-z .]{1,24}?)\s*(?:account)?\s*(https?:\/\/\S+)?$/i);
  if (linkCmd && !/\blink about\b|\bsaved?\b/i.test(q)) {
    const tool = await addLinkedTool(linkCmd[1], linkCmd[2]);
    if (tool) {
      return `Linked ${tool.name}. I'll keep it in mind${tool.url ? ` and can open it — say "open my ${tool.name}"` : ''}. It shows in your dashboard's connected tools too.`;
    }
  }
  const openCmd = q.match(/\b(?:open|launch|take me to|go to)\s+(?:my\s+)?([a-z][a-z .]{1,24}?)\s*$/i);
  if (openCmd) {
    const r = resolveTool(openCmd[1]);
    if (r) {
      const conns = await getConnections();
      const linked = (conns.tools ?? []).find((t) => t.key === r.key);
      const url = linked?.url ?? r.url;
      if (url && /^https?:\/\//.test(url)) {
        try {
          await chrome.tabs.create({ url });
        } catch {
          /* no tabs permission in some contexts */
        }
        return `Opening ${r.name} for you.`;
      }
    }
  }

  // Cancel a reminder / timer by voice — "cancel my reminder about X",
  // "clear all reminders". Placed before the "remind me" umbrella.
  if (/\b(cancel|remove|delete|forget|clear|stop)\b[^.]*\b(reminder|reminders|timer|timers)\b/i.test(q)) {
    const { 'nomi:reminders': rem } = await chrome.storage.local.get('nomi:reminders');
    const entries = Object.entries((rem ?? {}) as Record<string, { what?: string; at?: number }>).filter(
      ([, r]) => r && (r.at ?? 0) > now,
    );
    if (entries.length === 0) return "You don't have any reminders or timers pending.";
    if (/\ball\b/i.test(q)) {
      for (const [id] of entries) await chrome.alarms.clear(`nomi:reminder:${id}`);
      await chrome.storage.local.set({ 'nomi:reminders': {} });
      return `Cleared all ${entries.length} pending reminder${entries.length === 1 ? '' : 's'}.`;
    }
    const words = q
      .toLowerCase()
      .replace(/\b(cancel|remove|delete|forget|clear|stop|my|the|a|reminder|reminders|timer|timers|about|to|for)\b/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const hit =
      entries.find(([, r]) => words.some((w) => (r.what ?? '').toLowerCase().includes(w))) ?? entries[0];
    const [id, r] = hit;
    const next = { ...(rem as Record<string, unknown>) };
    delete next[id];
    await chrome.storage.local.set({ 'nomi:reminders': next });
    await chrome.alarms.clear(`nomi:reminder:${id}`);
    return `Done — cancelled "${r.what}".`;
  }

  // Mark an intention done / drop it — "mark X done", "I finished the resume",
  // "cross off X", "remove X from my list".
  if (/\b(mark|cross off|tick off|finished|completed|done with)\b|\b(remove|drop)\b[^.]*\b(from )?my (list|intentions?|todos?)\b/i.test(q)) {
    const words = q
      .toLowerCase()
      .replace(/\b(mark|cross|tick|off|finished|completed|done|with|remove|drop|from|my|list|the|as|intention|intentions|todo|todos|i)\b/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const done = await resolveIntention(
      (i) => words.length === 0 || words.some((w) => i.title.toLowerCase().includes(w)),
      /\bdrop|remove\b/i.test(q) ? 'dismissed' : 'done',
    );
    if (done) return `Nice — marked "${done.title}" ${/\bdrop|remove\b/i.test(q) ? 'dropped' : 'done'}. One less thing.`;
    // fall through if nothing matched — might be a normal sentence
  }

  // Reminders. Checked under one "remind me" umbrella so a request that names
  // a reminder but no shape we support gets an honest answer, never a
  // fabricated timer or a fall-through to generic chat.
  if (/\bremind me\b/i.test(q)) {
    // Context-triggered — "remind me when I open Gmail to …". Tried first
    // because it's the more specific shape.
    const site = parseSiteReminder(q);
    if (site) {
      const id = crypto.randomUUID();
      const { 'nomi:siteReminders': existing } = await chrome.storage.local.get('nomi:siteReminders');
      await chrome.storage.local.set({
        'nomi:siteReminders': {
          ...(existing ?? {}),
          [id]: { domain: site.domain, what: site.what, createdTs: now },
        },
      });
      return confirmSiteReminder(site);
    }

    const reminder = parseReminder(q);
    if (reminder) {
      const id = crypto.randomUUID();
      const { 'nomi:reminders': reminders } = await chrome.storage.local.get('nomi:reminders');
      await chrome.storage.local.set({
        'nomi:reminders': {
          ...(reminders ?? {}),
          [id]: { what: reminder.what, at: now + reminder.delayMs, createdTs: now },
        },
      });
      chrome.alarms.create(`nomi:reminder:${id}`, { when: now + reminder.delayMs });
      return confirmText(reminder);
    }

    // "remind me not in 1 hour, in 30 minutes" — all time, no task: that's a
    // correction to the reminder just set, not a new one.
    const fixed = await retimeLatestReminder(q, now);
    if (fixed) return fixed;

    // Named a reminder but no shape I can honour (e.g. an absolute date/time).
    // Say so plainly rather than invent a timer.
    return (
      "I can hold two kinds of reminder: a relative one — \"remind me to stretch in 20 minutes\" — " +
      'or one tied to a page — "remind me to reply when I open Gmail". ' +
      "I couldn't pin that down to either. Want to give it to me one of those ways?"
    );
  }

  // Spoken corrections that skip the words "remind me" — "no, in 30 minutes",
  // "actually make it an hour" — retime the reminder just set.
  if (/^(?:no+\b|nah\b|not\b|wait\b|actually\b|i (?:said|meant)\b|make (?:it|that)\b|change (?:it|that)\b|in\s)/i.test(q)) {
    const fixed = await retimeLatestReminder(q, now);
    if (fixed) return fixed;
  }

  // Personal Bag recall — "which link did I save about X?"
  if (isRecallLinks(q)) {
    const all = await getLinks();
    if (all.length === 0) {
      return (
        'I checked your bag and it has nothing in it right now. If you saved something and it\'s not here, that save didn\'t go through — ' +
        'open the page and say "save this page"; I\'ll confirm with the count so you know it stuck.'
      );
    }
    const hits = searchLinks(q, all);
    const shown = hits.length ? hits : all.slice().reverse();
    const head = hits.length
      ? `Found ${hits.length} in your bag${hits.length > 1 ? ' — tap to open' : ''}:`
      : `Your bag (${all.length}) — tap any to open:`;
    return (
      head +
      '\n' +
      shown
        .slice(0, 8)
        .map((l) => `• [${l.title}](${l.url}) — ${l.domain}`)
        .join('\n')
    );
  }

  // "remember that I ..." — a fact about the person, stored forever.
  const remember = parseRemember(q);
  if (remember) {
    await addFact(remember);
    void autodocTold(`You asked me to remember: ${remember}`);
    return `Got it — I'll remember that. (You can see and edit everything I know in Settings → What I remember.)`;
  }

  // "forget that / forget about X" — the user stays in control of memory.
  if (/^(?:nomi[,\s]+)?forget\b/i.test(q)) {
    const profile = await getProfile();
    if (profile.facts.length === 0) return "There's nothing saved about you to forget yet.";
    const target = q.replace(/^(?:nomi[,\s]+)?forget\s*(?:that|about)?\s*/i, '').trim();
    if (!target || /^(that|it|the last( one)?)$/i.test(target)) {
      const last = profile.facts[profile.facts.length - 1];
      await removeFact(last.id);
      return `Done — forgot "${last.text}".`;
    }
    const match = profile.facts.find((f) => f.text.toLowerCase().includes(target.toLowerCase()));
    if (match) {
      await removeFact(match.id);
      return `Done — forgot "${match.text}".`;
    }
    return "I couldn't find that among what I remember. Try Settings → What I remember to clear it.";
  }

  // Passively pick up the user's name if we don't have it yet.
  const profileNow = await getProfile();
  if (!profileNow.name) {
    const spotted = parseName(q);
    if (spotted) {
      await saveProfile({ ...profileNow, name: spotted });
      return `Nice to properly meet you, ${spotted}. I'll remember that.`;
    }
  }

  // A buddy answers hello like a person, not like a search box.
  if (/^(hi+|hey+|hello+|yo|sup|good (morning|afternoon|evening))[\s!.]*$/i.test(q)) {
    const hi = profileNow.name ? `Hey ${profileNow.name}!` : 'Hey!';
    return `${hi} Right here beside you. Ask for today's story, dig up a memory, or just talk.`;
  }
  if (/^(thanks|thank you|thx|ty)\b/i.test(q)) {
    return "Anytime. I'm not going anywhere.";
  }
  if (/\b(who|what) (are|r) (you|u)\b/i.test(q)) {
    const p = PERSONALITIES[profileNow.personality] ?? PERSONALITIES.friend;
    return `I'm Nomi — your companion sharing your workspace, in ${p.label.toLowerCase()} mode right now. I notice how your day flows, remember what matters${profileNow.name ? `, ${profileNow.name}` : ''}, and everything stays on this device.`;
  }
  if (/what can you do|^help[\s!?]*$|how do (i|you) work/i.test(q)) {
    return 'Lots — I can see your page and I remember you. Try: "summarize this" · "explain this error" · "read this to me" · "translate this to Hindi" · "what\'s 15% of 2400" · "3pm PST in IST" · "days until Aug 15" · "set a timer for 10 min" · "remind me to stretch in 20 min" · "how\'s today going?" · "what am I putting off?" · "focus with me for 25 minutes".';
  }

  // "focus with me for 25 minutes" / "for an hour" / "for half an hour" —
  // fully dynamic, any duration (Core Vision #2). Nomi holds the clock.
  const focus = q.match(
    /focus (?:with me )?(?:for )?(\d+|an?|half an|a couple(?: of)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i,
  );
  if (focus) {
    const isHour = /^h/i.test(focus[2]);
    const wordNum: Record<string, number> = { a: 1, an: 1, 'half an': 0.5, 'a couple': 2, 'a couple of': 2 };
    const qty = /^\d+$/.test(focus[1]) ? Number(focus[1]) : (wordNum[focus[1].toLowerCase()] ?? 1);
    const mins = Math.max(1, Math.round(qty * (isHour ? 60 : 1)));
    const until = now + mins * 60000;
    await chrome.storage.local.set({ 'nomi:focusSession': { until, minutes: mins } });
    chrome.alarms.create('nomi:focusEnd', { when: until });
    await chrome.storage.session.set({ 'nomi:mood': { kind: 'focus' } });
    return `${mins} minutes, heads down. I'll keep everything quiet and hold the clock — go.`;
  }

  if (/how('s| is| was)? (it going|today|the day)|today so far|what (did|have) i (do|done)/i.test(q)) {
    const rollup = await todayRollup(now);
    return rollup.totalMs < 60000 ? todayLine(now) : narrate(rollup);
  }

  // "what was I doing?" / "where did I leave off?" — resume the open loop:
  // the deep session from the last few days they haven't returned to.
  if (/\bwhat was i (doing|working on|reading)\b|\bwhere (did|was) i (leave|left) off\b|\bpick (it |that )?(back )?up\b|\bcontinue where i left\b/i.test(q)) {
    const recent = await sessionsSince(now - 4 * 86400000);
    const dayStart = startOfDay(now);
    const todayDomains = new Set(recent.filter((s) => s.startTs >= dayStart).map((s) => s.domain));
    const loop = findOpenLoop(recent, todayDomains, now);
    if (loop) {
      return `${describeOpenLoop(loop)}\n• [${loop.domain}](${loop.url}) — tap to pick it back up.`;
    }
    const last = recent.filter((s) => s.durationMs >= 5 * 60000).sort((a, b) => b.startTs - a.startTs)[0];
    if (last) {
      const m = Math.round(last.durationMs / 60000);
      return `Most recently: ${m} minutes on [${last.domain}](https://${last.domain}${last.path ?? ''}). Nothing older is hanging unfinished.`;
    }
    return "I don't have a recent deep session on record to hand back yet — give me a day of browsing.";
  }

  // "when do I work best?" / "my energy" — the pattern worth protecting.
  if (/\bwhen (do|am) i (work|at my|most (productive|focused))\b|\bmy (energy|peak hours?|best (time|hours?))\b|\bbest time (for me )?to (work|study|focus)\b/i.test(q)) {
    const learned = (await getProfile()).learned;
    if (!learned || learned.peakHours.length === 0) {
      return "I haven't seen enough days yet to name your peak hours — patterns need to repeat before I'll claim them.";
    }
    const hrs = learned.peakHours.map((h) => (h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`)).join(', ');
    const drift = learned.typicalDistractions[0];
    return (
      `Your deepest hours land around ${hrs} — that's when the long sessions happen. Worth protecting for the hard work.` +
      (drift ? ` (${drift} is what usually eats them.)` : '')
    );
  }

  // "what changed in me?" / "how am I changing?" / "what are my patterns?" —
  // answered from the learned profile + the living document's change log,
  // never from thin air.
  if (
    /\bwhat.{0,16}chang(ed|ing|es)\b.{0,20}\b(me|my|i)\b|\bhow (am|have) i (been )?(chang|behav|evolv)|\bmy (habits?|patterns?|behaviou?rs?|routines?)\b/i.test(
      q,
    )
  ) {
    const learned = (await getProfile()).learned ?? EMPTY_LEARNED;
    const desc = describeLearned(learned);
    const recentChanges = (await getAutodoc()).changes.slice(-3).reverse();
    if (!desc && recentChanges.length === 0) {
      return "Give me a few more days — I only claim a pattern once I've seen it repeat, never from one event.";
    }
    const parts: string[] = [];
    if (desc) parts.push(desc.replace(/^What you've learned about them[^:]*: /, 'What I see: '));
    if (recentChanges.length) {
      parts.push(
        'What changed lately:\n' +
          recentChanges.map((c) => `• ${new Date(c.ts).toLocaleDateString()} — ${c.text}`).join('\n'),
      );
    }
    parts.push('The full picture lives in "About you — Nomi\'s notes" in your Nomi Space.');
    return parts.join('\n\n');
  }

  if (isMemoryQuery(q)) {
    const rollups = await allRollups();
    const answer = searchMemory(q, {
      sessions: await sessionsSince(0),
      rollups,
      events: await eventsSince(0),
      now,
    });
    if (!answer.startsWith("I don't remember")) return answer;
    // Keyword memory came up dry — try SEMANTIC recall over days + journal
    // ("when did I research visas?" finds the immigration-paperwork day).
    const hits = await ragSearchMemory(q, memoryPassages(rollups, await getJournal()), 3);
    if (hits.length) return 'Closest I have:\n' + hits.map((h) => `• ${h}`).join('\n');
    return answer;
  }

  const settings = await getSettings();

  // ---- on-demand skills that lean on the page + a model ----
  const skillReply = await runPageSkill(q, screenContext, profileNow, settings);
  if (skillReply !== null) return skillReply;

  // Search the user's own documents first — answer from their material when
  // it fits, before reaching for general knowledge.
  const allDocs = await getDocs();
  let docHits = await ragSearchDocs(q, allDocs, 5);
  // Thin retrieval on a real question → rewrite the query once (synonyms,
  // expansions) and search again. One cheap model call, big recall win.
  if (allDocs.length > 0 && docHits.length < 2 && q.split(/\s+/).length >= 3) {
    const expanded = await expandQuery(q, settings);
    if (expanded) {
      const more = await ragSearchDocs(`${q} ${expanded}`, allDocs, 5);
      const seen = new Set(docHits.map((h) => h.passage));
      docHits = [...docHits, ...more.filter((h) => !seen.has(h.passage))].slice(0, 5);
    }
  }
  const docContext = docHits.length
    ? docHits.map((h) => `[${h.docName}] ${h.passage}`).join('\n---\n')
    : undefined;
  // Day-memory that relates to the question rides along in the prompt.
  const memHits = await ragSearchMemory(q, memoryPassages(await allRollups(), await getJournal()), 3);
  const retrievedBits = [
    await retrieveForPrompt(q, profileNow.facts.map((f) => f.text)),
    memHits.length ? `From their day-memory (what they actually did): ${memHits.join(' | ')}` : undefined,
  ].filter(Boolean);
  const system = buildSystemPrompt({
    profile: profileNow,
    todayContext: await todayLine(now),
    screenContext,
    docContext,
    liveContext: await liveContextBlock(now),
    retrieved: retrievedBits.length ? retrievedBits.join('\n') : undefined,
    language: settings.language,
  });
  const messages = [
    ...history.slice(-8).map((m) => ({
      role: m.role === 'nomi' ? ('assistant' as const) : ('user' as const),
      content: m.text,
    })),
    { role: 'user' as const, content: q },
  ];

  // Reasoning brain (V3): let Nomi think in steps and consult its own tools
  // before answering — for ANY available brain (Gemini, Ollama, or the free
  // fallback). The loop degrades gracefully: if the model just answers without
  // asking for a tool, that reply is used as-is (single round-trip), so the
  // free brain still works and chat never goes silent.
  const capable =
    (settings.gemini.enabled && settings.gemini.apiKey.trim()) || settings.ollama.enabled || settings.freeChat;
  if (capable) {
    try {
      const turns: ChatTurn[] = history.slice(-6).map((m) => ({
        role: m.role === 'nomi' ? 'assistant' : 'user',
        content: m.text,
      }));
      return await runAgent(q, turns, {
        ask: (sys, msgs) => askModel(sys, msgs, settings),
        tools: agentTools(screenContext, now),
        base: system,
        maxSteps: 4,
      });
    } catch {
      // fall through to a plain answer
    }
  }
  return askModel(system, messages, settings);
}

type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** The tools Nomi can reason with — each grounded in the user's own local
 * data. Passed to the ReAct loop in lib/agent.ts. */
function agentTools(screenContext: string | undefined, now: number): AgentTool[] {
  return [
    {
      name: 'recall',
      desc: "search the user's activity memory — sites visited & when, solved problems, watched videos",
      run: async (query) =>
        searchMemory(query, {
          sessions: await sessionsSince(0),
          rollups: await allRollups(),
          events: await eventsSince(0),
          now,
        }),
    },
    {
      name: 'page',
      desc: 'read the visible text of the page the user is looking at right now',
      run: async () => screenText(screenContext) || 'No readable page text right now.',
    },
    {
      name: 'intentions',
      desc: "list the user's open unfinished intentions (things they meant to do)",
      run: async () => {
        const open = await getOpenIntentions();
        return open.length
          ? open.map((i) => `- ${i.title}${i.relatedProject ? ` (${i.relatedProject})` : ''}`).join('\n')
          : 'No open intentions.';
      },
    },
    {
      name: 'docs',
      desc: "search the user's uploaded documents (their Nomi Space)",
      run: async (query) => {
        const hits = await ragSearchDocs(query, await getDocs(), 5);
        return hits.length ? hits.map((h) => `[${h.docName}] ${h.passage}`).join('\n---\n') : 'Nothing in their documents matches.';
      },
    },
    {
      name: 'today',
      desc: "a summary of the user's activity today",
      run: async () => {
        const r = await todayRollup(now);
        return r.totalMs < 60000 ? await todayLine(now) : narrate(r);
      },
    },
    {
      name: 'calc',
      desc: 'evaluate math / conversions, e.g. calc(15% of 2400) or calc(5 km in miles)',
      run: async (expr) => {
        const u = tryUtility(expr, now);
        if (u) return u;
        const n = calc(expr);
        return n !== null ? String(n) : 'Not a valid expression.';
      },
    },
    {
      name: 'bag',
      desc: "the user's saved links / things they kept for later (their bag)",
      run: async () => {
        const l = await getLinks();
        return l.length ? l.slice(-8).reverse().map((x) => `- ${x.title} (${x.domain})`).join('\n') : 'Their bag is empty.';
      },
    },
    {
      name: 'reminders',
      desc: "the user's pending reminders and timers",
      run: async () => {
        const { 'nomi:reminders': r } = await chrome.storage.local.get('nomi:reminders');
        const pending = Object.values((r ?? {}) as Record<string, { what?: string; at?: number }>)
          .filter((x) => x && (x.at ?? 0) > now)
          .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
        return pending.length
          ? pending.map((x) => `- ${x.what} (in ${Math.max(1, Math.round(((x.at ?? now) - now) / 60000))} min)`).join('\n')
          : 'No pending reminders or timers.';
      },
    },
    {
      name: 'connections',
      desc: "the user's linked accounts & tools — LeetCode, GitHub, Notion, Obsidian, calendar, etc.",
      run: async () => describeConnections(await getConnections()),
    },
    {
      name: 'profile',
      desc: 'what you know about the user — name, goal, saved facts, learned habits',
      run: async () => {
        const p = await getProfile();
        const bits: string[] = [];
        if (p.name) bits.push(`Name: ${p.name}`);
        if (p.goal) bits.push(`Goal: ${p.goal}`);
        if (p.facts.length) bits.push('Facts: ' + p.facts.map((f) => f.text).join('; '));
        if (p.learned) {
          const l = describeLearned(p.learned);
          if (l) bits.push(l);
        }
        return bits.join('\n') || 'Nothing saved about them yet.';
      },
    },
  ];
}

/** Pull just the visible page text out of the composed screen-context string
 * (which is "label\n\nVisible content:\n<text>"). '' when there's no text. */
function screenText(screenContext?: string): string {
  if (!screenContext) return '';
  const m = screenContext.match(/Visible content:\n([\s\S]*)$/);
  return (m ? m[1] : '').trim();
}

/** On-demand skills grounded in the current page: read-aloud, summarize /
 * explain / key-points, and translate / define. Returns the reply, or null if
 * the message isn't one of these skills (so chat falls through to freeform). */
async function runPageSkill(
  q: string,
  screenContext: string | undefined,
  profile: Awaited<ReturnType<typeof getProfile>>,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<string | null> {
  const page = screenText(screenContext);

  // Read it to me — return the visible text so the widget speaks it aloud.
  if (/\b(read (?:this|it|the page)(?: to me| aloud| out loud)?|read aloud|read out loud)\b/i.test(q)) {
    if (!page) return "I can't read this page out — it looks empty or restricted. Open a normal article and try again.";
    const trimmed = page.length > 1400 ? page.slice(0, 1400).replace(/\s+\S*$/, '') + '…' : page;
    return `Sure — here goes:\n\n${trimmed}`;
  }

  // Summarize / explain / key points / explain this error — needs the page.
  const assist = /\b(summari[sz]e|tl;?dr|key points|explain (?:this|it|the|this error|this code)|what does this (?:say|mean)|break (?:this|it) down|gist of this)\b/i.test(q);
  // Translate / define — work on the page or the user's own words.
  const translate = /\btranslate\b|\bin (?:hindi|spanish|french|german|hinglish|english|japanese|tamil|telugu|marathi|bengali)\b|\bwhat does\b.*\bmean\b|\bdefine\b|\beli5\b|\bexplain like i'?m (?:5|five)\b/i.test(q);
  if (!assist && !translate) return null;

  const task = assist
    ? 'The user wants you to help with what is on their screen (summarize / explain / pull key points / explain an error). Base your answer ONLY on the visible page content provided. Be concise and concrete; if the page has no relevant content, say so plainly.'
    : 'The user wants a translation or a definition. If they refer to "this", use the visible page content. Keep it natural and short.';

  if (assist && !page) {
    return "I can't see readable text on this page right now — it might be a restricted or image-only page. Select the part you want and ask again, or paste it to me.";
  }

  const system = buildSystemPrompt({
    profile,
    todayContext: 'skill request',
    screenContext,
    language: settings.language,
  }) + `\n\nSKILL: ${task}`;
  return askModel(system, [{ role: 'user', content: q }], settings);
}

/** Query rewriting for retrieval: turn a short/vague question into extra
 * search terms (synonyms, related phrasing). One cheap call; empty string on
 * any failure so retrieval never blocks on it. */
async function expandQuery(
  q: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<string> {
  const capable =
    (settings.gemini.enabled && settings.gemini.apiKey.trim()) || settings.ollama.enabled || settings.freeChat;
  if (!capable) return '';
  try {
    const out = await askModel(
      'You expand search queries. Reply with ONLY 4-8 additional search keywords/synonyms for the query, space-separated, no punctuation, no explanations.',
      [{ role: 'user', content: q }],
      settings,
    );
    if (out.length > 120) return ''; // an error/fallback sentence, not keywords
    const words = out.replace(/[^a-zA-Z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
    return words.join(' ');
  } catch {
    return '';
  }
}

/** The provider chain: best brain first, each failure falls through to the
 * next, so a quota error never reads as Nomi going silent. Shared by freeform
 * chat and the LLM-backed skills (summarize, translate, …). */
async function askModel(
  system: string,
  messages: ChatTurn[],
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<string> {
  const providers: (() => Promise<string>)[] = [];
  if (settings.gemini.enabled && settings.gemini.apiKey.trim()) {
    providers.push(() =>
      geminiChat({ apiKey: settings.gemini.apiKey.trim(), model: settings.gemini.model, system, messages }),
    );
  }
  if (settings.ollama.enabled) {
    providers.push(() => ollamaChat({ model: settings.ollama.model, system, messages }));
  }
  if (settings.freeChat) {
    providers.push(() => freeChat({ system, messages }));
  }
  if (providers.length === 0) return NO_LLM_FALLBACK;

  let lastError = '';
  for (const provider of providers) {
    try {
      return await provider();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (lastError.startsWith('gemini')) return GEMINI_ERROR_FALLBACK;
  if (settings.ollama.enabled && !settings.freeChat) return OLLAMA_ERROR_FALLBACK;
  return "Every chat brain I can reach is having a moment — try me again in a minute. Today's story, memory, and reminders all still work.";
}
