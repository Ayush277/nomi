import { observableUrl } from './privacy';
import { getSettings } from './settings';
import { addEvent, addSession } from './store';
import type { CurrentVisit, NomiEvent, SiteCategory, SiteSignal } from './types';

/** Spike A (ADR-2): the MV3 worker is stateless and ephemeral, so the
 * in-flight visit lives in chrome.storage.session — it survives worker
 * cold-starts and is naturally dropped when the browser closes.
 * Every handler is read state → decide → write state. */

const CURRENT_VISIT_KEY = 'nomi:currentVisit';

export async function getCurrentVisit(): Promise<CurrentVisit | null> {
  const stored = await chrome.storage.session.get(CURRENT_VISIT_KEY);
  return stored[CURRENT_VISIT_KEY] ?? null;
}

async function setCurrentVisit(visit: CurrentVisit | null): Promise<void> {
  if (visit) {
    await chrome.storage.session.set({ [CURRENT_VISIT_KEY]: visit });
  } else {
    await chrome.storage.session.remove(CURRENT_VISIT_KEY);
  }
}

function makeEvent(
  type: NomiEvent['type'],
  domain: string,
  category: SiteCategory,
  extra: Partial<NomiEvent> = {},
): NomiEvent {
  return { id: crypto.randomUUID(), ts: Date.now(), type, domain, category, ...extra };
}

/** Close the in-flight visit: emit visit_end + a queryable session row.
 * Sub-2s touches are noise (tab flicking) — dropped, not stored. */
async function closeVisit(visit: CurrentVisit, endTs: number): Promise<void> {
  const durationMs = endTs - visit.startTs;
  if (durationMs < 2000) return;
  await addEvent(
    makeEvent('visit_end', visit.domain, visit.category, { path: visit.path, durationMs }),
  );
  await addSession({
    id: crypto.randomUUID(),
    domain: visit.domain,
    path: visit.path,
    category: visit.category,
    startTs: visit.startTs,
    endTs,
    durationMs,
  });
}

/** Serialize transitions within one worker lifetime; tab-switch + navigation
 * events for the same gesture arrive microseconds apart and would otherwise
 * race the read-modify-write on storage. */
let chain: Promise<void> = Promise.resolve();
function serialized(fn: () => Promise<void>): Promise<void> {
  chain = chain.then(fn, fn);
  return chain;
}

/** The single entry point for "the user's attention is now here (or nowhere)".
 * Pass a raw URL + tabId, or null for blur/idle/lock. */
export function transitionTo(rawUrl: string | null, tabId: number | null): Promise<void> {
  return serialized(async () => {
    const now = Date.now();
    const settings = await getSettings();
    const current = await getCurrentVisit();

    const next =
      !settings.paused && rawUrl !== null && tabId !== null
        ? observableUrl(rawUrl, settings.exclusions)
        : null;

    if (current && next && current.tabId === tabId && current.domain === next.domain) {
      // Same place; just remember the latest path for a more specific record.
      if (current.path !== next.path) {
        await setCurrentVisit({ ...current, path: next.path });
      }
      return;
    }

    if (current) await closeVisit(current, now);

    if (next && tabId !== null) {
      const visit: CurrentVisit = {
        tabId,
        domain: next.domain,
        path: next.path,
        category: next.category,
        startTs: now,
      };
      await setCurrentVisit(visit);
      await addEvent(makeEvent('visit_start', next.domain, next.category, { path: next.path }));
    } else {
      await setCurrentVisit(null);
    }
  });
}

/** Marker events consumed by the nudge engine. */
export function recordMarker(type: 'tab_switch' | 'idle_start' | 'idle_end'): Promise<void> {
  return serialized(async () => {
    const settings = await getSettings();
    if (settings.paused) return;
    await addEvent(makeEvent(type, '', 'other'));
  });
}

/** Adapter signal (already validated against the ADR-5 contract). */
export function recordSignal(signal: SiteSignal, domain: string, category: SiteCategory): Promise<void> {
  return serialized(async () => {
    const settings = await getSettings();
    if (settings.paused) return;
    await addEvent(makeEvent('site_signal', domain, category, { signal }));
  });
}
