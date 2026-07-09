import type { SiteSignal } from './types';

/** The whitelisted-signal contract (ADR-5 Tier 2). Adapters run in page
 * contexts, so the background NEVER trusts what they send: every signal is
 * validated here — unknown adapters, kinds, and fields are dropped, values
 * are type-checked and length-capped. This is the choke point that keeps
 * "deep signals" from quietly becoming "page scraping". */

interface FieldSpec {
  type: 'string' | 'number';
  maxLen?: number;
  oneOf?: string[];
}

const CONTRACTS: Record<string, Record<string, Record<string, FieldSpec>>> = {
  leetcode: {
    submission_accepted: {
      slug: { type: 'string', maxLen: 120 },
      difficulty: { type: 'string', oneOf: ['Easy', 'Medium', 'Hard', 'unknown'] },
    },
  },
};

export function validateSignal(raw: {
  adapter?: unknown;
  kind?: unknown;
  data?: unknown;
}): SiteSignal | null {
  if (typeof raw.adapter !== 'string' || typeof raw.kind !== 'string') return null;
  const contract = CONTRACTS[raw.adapter]?.[raw.kind];
  if (!contract || typeof raw.data !== 'object' || raw.data === null) return null;

  const input = raw.data as Record<string, unknown>;
  const data: Record<string, string | number> = {};
  for (const [field, spec] of Object.entries(contract)) {
    const value = input[field];
    if (spec.type === 'string') {
      if (typeof value !== 'string') return null;
      if (spec.maxLen && value.length > spec.maxLen) return null;
      if (spec.oneOf && !spec.oneOf.includes(value)) return null;
      data[field] = value;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      data[field] = value;
    }
  }
  // Unknown extra fields are silently dropped by construction.
  return { adapter: raw.adapter, kind: raw.kind, data };
}
