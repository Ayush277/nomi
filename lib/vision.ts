/** Vision Understanding (V2 Upgrade 4) — when the user opts in, the background
 * captures the visible tab, a vision model turns the pixels into STRUCTURED
 * fields, and the image is discarded immediately (never stored, never sent
 * anywhere but the user's own Gemini). This module owns the prompt + the
 * defensive parsing of the model's JSON; the background does the capture I/O.
 *
 * Privacy contract mirrors the rest of Nomi: only structured text is kept, and
 * only on non-sensitive, non-incognito, non-paused pages the user allows. */

export interface VisionSnapshot {
  application: string | null;
  visibleText: string | null;
  buttons: string[];
  errors: string[];
  editor: string | null;
  repository: string | null;
  pullRequest: string | null;
  pdfTitle: string | null;
  forms: string[];
  capturedTs: number;
}

export const EMPTY_VISION: VisionSnapshot = {
  application: null,
  visibleText: null,
  buttons: [],
  errors: [],
  editor: null,
  repository: null,
  pullRequest: null,
  pdfTitle: null,
  forms: [],
  capturedTs: 0,
};

/** The instruction handed to the vision model. Asks for strict JSON so parsing
 * is deterministic; every field is optional and defaults to null/[]. */
export function visionPrompt(): string {
  return [
    'Look at this screenshot of a browser tab and extract ONLY what is actually visible.',
    'Reply with STRICT JSON (no markdown fence, no commentary) of this exact shape:',
    '{"application":string|null,"visibleText":string|null,"buttons":string[],"errors":string[],',
    '"editor":string|null,"repository":string|null,"pullRequest":string|null,"pdfTitle":string|null,"forms":string[]}',
    '- application: the app/site in view (e.g. "GitHub", "VS Code", "Gmail").',
    '- visibleText: a short summary of the main visible text (max ~300 chars).',
    '- buttons: important action buttons visible (e.g. "Merge pull request").',
    '- errors: any error or warning messages shown, verbatim if short.',
    '- editor / repository / pullRequest / pdfTitle: fill only if clearly present, else null.',
    '- forms: names/labels of any forms or key input fields (never their values).',
    'Never include passwords, card numbers, or the contents of input fields. If unsure, use null.',
  ].join('\n');
}

function strOrNull(v: unknown, max = 400): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

function strArray(v: unknown, maxItems = 8, maxLen = 120): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

/** Parse the model's reply into a VisionSnapshot. Tolerant: strips code fences,
 * finds the JSON object, and never throws — malformed input yields EMPTY. */
export function parseVisionResult(raw: string, now = Date.now()): VisionSnapshot {
  if (!raw) return { ...EMPTY_VISION, capturedTs: now };
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return { ...EMPTY_VISION, capturedTs: now };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return { ...EMPTY_VISION, capturedTs: now };
  }
  return {
    application: strOrNull(obj.application, 80),
    visibleText: strOrNull(obj.visibleText, 400),
    buttons: strArray(obj.buttons),
    errors: strArray(obj.errors),
    editor: strOrNull(obj.editor, 80),
    repository: strOrNull(obj.repository, 120),
    pullRequest: strOrNull(obj.pullRequest, 160),
    pdfTitle: strOrNull(obj.pdfTitle, 160),
    forms: strArray(obj.forms),
    capturedTs: now,
  };
}

/** True when the snapshot carries anything worth handing to the prompt. */
export function hasVisionSignal(v: VisionSnapshot): boolean {
  return Boolean(
    v.application ||
      v.visibleText ||
      v.errors.length ||
      v.editor ||
      v.repository ||
      v.pullRequest ||
      v.pdfTitle,
  );
}

/** Render the structured snapshot for the system prompt. */
export function describeVision(v: VisionSnapshot): string | null {
  if (!hasVisionSignal(v)) return null;
  const bits: string[] = [];
  if (v.application) bits.push(`app: ${v.application}`);
  if (v.repository) bits.push(`repo: ${v.repository}`);
  if (v.pullRequest) bits.push(`PR: ${v.pullRequest}`);
  if (v.editor) bits.push(`editor: ${v.editor}`);
  if (v.pdfTitle) bits.push(`PDF: ${v.pdfTitle}`);
  if (v.errors.length) bits.push(`errors on screen: ${v.errors.slice(0, 2).join(' | ')}`);
  if (v.buttons.length) bits.push(`key buttons: ${v.buttons.slice(0, 3).join(', ')}`);
  if (v.visibleText) bits.push(`showing: ${v.visibleText}`);
  return `On screen right now (from a vision read): ${bits.join('; ')}.`;
}
