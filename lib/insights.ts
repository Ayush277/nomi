/** Screen-honest insights — did YouTube (or any social/entertainment tab)
 * during a study block carry study content, or was it a drift? Matched from
 * what was actually on screen: video titles captured by the adapters against
 * the study session's own vocabulary (domains, paths, projects, solved
 * problems). Pure functions over the event stream, per the conventions. */

import type { VisitSession } from './types';

export interface DriftReport {
  /** Total focused (coding/learning) time in the block. */
  studyMs: number;
  /** Social/entertainment time interleaved with that block. */
  watchMs: number;
  /** Of that, time whose on-screen content matched the study topic. */
  relatedMs: number;
  /** And time that didn't — the honest drift. */
  driftMs: number;
  /** Example titles judged study-related. */
  related: string[];
  /** Example titles/domains judged drift. */
  drift: string[];
}

const WATCH_CATEGORIES = new Set(['social', 'entertainment', 'music']);
/** Words that mark a video as learning material even without a topic match. */
const STUDY_WORDS = new Set([
  'tutorial', 'course', 'lecture', 'explained', 'explanation', 'learn', 'learning',
  'interview', 'leetcode', 'algorithm', 'algorithms', 'dsa', 'coding', 'programming',
  'crash', 'guide', 'walkthrough', 'masterclass', 'fundamentals', 'documentation',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/** The study block's own vocabulary: domain words, path words, project names,
 * solved slugs. "react.dev/learn" contributes react + learn, etc. */
function studyVocabulary(
  study: VisitSession[],
  projects: string[],
  solvedSlugs: string[],
): Set<string> {
  const vocab = new Set<string>();
  for (const s of study) {
    for (const part of s.domain.split('.')) if (part.length > 3) vocab.add(part);
    for (const w of tokens((s.path ?? '').replace(/[/-]/g, ' '))) vocab.add(w);
  }
  for (const p of projects) for (const w of tokens(p)) vocab.add(w);
  for (const slug of solvedSlugs) for (const w of tokens(slug.replace(/-/g, ' '))) vocab.add(w);
  return vocab;
}

export function isStudyContent(title: string, vocab: Set<string>): boolean {
  const words = tokens(title);
  return words.some((w) => STUDY_WORDS.has(w) || vocab.has(w));
}

/** Analyze one day: find the study window, the watch-time interleaved with
 * it, and split that time into related vs drift using what was on screen.
 * Null when there wasn't a real study block (≥15 min) to judge against. */
export function analyzeStudyDrift(
  sessions: VisitSession[],
  videos: { title: string; ts: number }[],
  projects: string[] = [],
  solvedSlugs: string[] = [],
): DriftReport | null {
  const study = sessions.filter((s) => s.category === 'coding' || s.category === 'learning');
  const studyMs = study.reduce((sum, s) => sum + s.durationMs, 0);
  if (studyMs < 15 * 60000) return null;

  const PAD = 15 * 60000;
  const from = Math.min(...study.map((s) => s.startTs)) - PAD;
  const to = Math.max(...study.map((s) => s.endTs)) + PAD;
  const watch = sessions.filter(
    (s) => WATCH_CATEGORIES.has(s.category) && s.startTs < to && s.endTs > from,
  );
  const watchMs = watch.reduce((sum, s) => sum + s.durationMs, 0);
  if (watchMs === 0) {
    return { studyMs, watchMs: 0, relatedMs: 0, driftMs: 0, related: [], drift: [] };
  }

  const vocab = studyVocabulary(study, projects, solvedSlugs);
  let relatedMs = 0;
  let driftMs = 0;
  const related: string[] = [];
  const drift: string[] = [];
  for (const s of watch) {
    // What was on screen during this stretch — titles the adapter captured.
    const seen = videos.filter((v) => v.ts >= s.startTs - 2 * 60000 && v.ts <= s.endTs + 2 * 60000);
    const isRelated = seen.length > 0 && seen.every((v) => isStudyContent(v.title, vocab));
    if (isRelated) {
      relatedMs += s.durationMs;
      for (const v of seen) if (!related.includes(v.title)) related.push(v.title);
    } else {
      driftMs += s.durationMs;
      if (seen.length) {
        for (const v of seen) if (!drift.includes(v.title)) drift.push(v.title);
      } else if (!drift.includes(s.domain)) {
        drift.push(s.domain);
      }
    }
  }
  return {
    studyMs,
    watchMs,
    relatedMs,
    driftMs,
    related: related.slice(0, 4),
    drift: drift.slice(0, 4),
  };
}
