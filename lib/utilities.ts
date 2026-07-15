/** Instant utilities — offline, no LLM, always snappy. Math, percentages, unit
 * & timezone conversions, and "days until <date>". All pure so the whole thing
 * is unit-testable; chat.ts tries these before reaching for a model. Returns a
 * ready-to-say answer string, or null when the message isn't a utility. */

// --- safe arithmetic (no eval) ---------------------------------------------

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'paren'; v: '(' | ')' };

function tokenize(expr: string): Tok[] | null {
  const toks: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([+\-*/^%])|(\()|(\)))/y;
  let i = 0;
  while (i < expr.length) {
    re.lastIndex = i;
    const m = re.exec(expr);
    if (!m || m.index !== i) return null;
    if (m[1]) toks.push({ t: 'num', v: Number(m[1]) });
    else if (m[2]) toks.push({ t: 'op', v: m[2] });
    else if (m[3]) toks.push({ t: 'paren', v: '(' });
    else if (m[4]) toks.push({ t: 'paren', v: ')' });
    i = re.lastIndex;
  }
  return toks.length ? toks : null;
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };

/** Evaluate a simple arithmetic expression safely, or null on any malformity. */
export function calc(expr: string): number | null {
  const toks = tokenize(expr);
  if (!toks) return null;
  const out: Tok[] = [];
  const ops: (Tok & { t: 'op' | 'paren' })[] = [];
  let prev: Tok | null = null;
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === 'num') out.push(tk);
    else if (tk.t === 'op') {
      // Unary minus/plus at start or after another operator/paren.
      if ((tk.v === '-' || tk.v === '+') && (!prev || prev.t === 'op' || (prev.t === 'paren' && prev.v === '('))) {
        out.push({ t: 'num', v: 0 });
      }
      while (
        ops.length &&
        ops[ops.length - 1].t === 'op' &&
        PREC[(ops[ops.length - 1] as { v: string }).v] >= PREC[tk.v] &&
        tk.v !== '^'
      ) {
        out.push(ops.pop()!);
      }
      ops.push(tk);
    } else if (tk.v === '(') ops.push(tk);
    else {
      while (ops.length && !(ops[ops.length - 1].t === 'paren')) out.push(ops.pop()!);
      if (!ops.length) return null;
      ops.pop(); // discard '('
    }
    prev = tk;
  }
  while (ops.length) {
    const o = ops.pop()!;
    if (o.t === 'paren') return null;
    out.push(o);
  }
  const st: number[] = [];
  for (const tk of out) {
    if (tk.t === 'num') st.push(tk.v);
    else {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) return null;
      st.push(
        tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b : tk.v === '/' ? a / b : tk.v === '%' ? a % b : a ** b,
      );
    }
  }
  const r = st.length === 1 ? st[0] : null;
  return r === null || !Number.isFinite(r) ? null : r;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

// --- unit conversion -------------------------------------------------------

// Everything reduces to a base unit per family (metres, grams, celsius).
const LENGTH: Record<string, number> = {
  km: 1000, kilometre: 1000, kilometer: 1000, kilometres: 1000, kilometers: 1000,
  m: 1, metre: 1, meter: 1, metres: 1, meters: 1,
  cm: 0.01, mm: 0.001,
  mi: 1609.344, mile: 1609.344, miles: 1609.344,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  yd: 0.9144, yard: 0.9144, yards: 0.9144,
};
const WEIGHT: Record<string, number> = {
  kg: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
  g: 1, gram: 1, grams: 1, mg: 0.001,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
};
const TEMP = new Set(['c', 'celsius', 'f', 'fahrenheit', 'centigrade']);

function convertUnit(n: number, from: string, to: string): string | null {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (LENGTH[f] && LENGTH[t]) return `${fmt(n)} ${from} = ${fmt((n * LENGTH[f]) / LENGTH[t])} ${to}`;
  if (WEIGHT[f] && WEIGHT[t]) return `${fmt(n)} ${from} = ${fmt((n * WEIGHT[f]) / WEIGHT[t])} ${to}`;
  if (TEMP.has(f) && TEMP.has(t)) {
    const toC = f.startsWith('f') ? ((n - 32) * 5) / 9 : n;
    const out = t.startsWith('f') ? (toC * 9) / 5 + 32 : toC;
    return `${fmt(n)}°${from[0].toUpperCase()} = ${fmt(Math.round(out * 10) / 10)}°${to[0].toUpperCase()}`;
  }
  return null;
}

// --- timezone (fixed standard offsets — approximate, ignores DST) ----------

const TZ: Record<string, { off: number; label: string }> = {
  utc: { off: 0, label: 'UTC' }, gmt: { off: 0, label: 'GMT' },
  pst: { off: -480, label: 'PST' }, pdt: { off: -420, label: 'PDT' },
  mst: { off: -420, label: 'MST' }, cst: { off: -360, label: 'CST' },
  est: { off: -300, label: 'EST' }, edt: { off: -240, label: 'EDT' },
  bst: { off: 60, label: 'BST' }, cet: { off: 60, label: 'CET' }, cest: { off: 120, label: 'CEST' },
  ist: { off: 330, label: 'IST' }, sgt: { off: 480, label: 'SGT' }, hkt: { off: 480, label: 'HKT' },
  jst: { off: 540, label: 'JST' }, aest: { off: 600, label: 'AEST' }, gst: { off: 240, label: 'GST' },
};

function convertZone(h: number, min: number, ampm: string | undefined, from: string, to: string): string | null {
  const a = TZ[from.toLowerCase()];
  const b = TZ[to.toLowerCase()];
  if (!a || !b) return null;
  let hour = h;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  const totalUtc = hour * 60 + min - a.off;
  let t = (((totalUtc + b.off) % 1440) + 1440) % 1440;
  const oh = Math.floor(t / 60);
  const om = t % 60;
  const disp12 = ((oh + 11) % 12) + 1;
  const suffix = oh < 12 ? 'am' : 'pm';
  const src = ampm ? `${h}${min ? ':' + String(min).padStart(2, '0') : ''}${ampm.toLowerCase()}` : `${h}:${String(min).padStart(2, '0')}`;
  return `${src} ${a.label} = ${disp12}:${String(om).padStart(2, '0')}${suffix} ${b.label} (approx, no DST)`;
}

// --- days until ------------------------------------------------------------

function daysUntil(target: string, now: number): string | null {
  const cleaned = target.trim().replace(/[?.!]+$/, '');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let d: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    d = new Date(cleaned + 'T00:00:00');
  } else {
    const parsed = Date.parse(`${cleaned} ${today.getFullYear()}`);
    if (!Number.isNaN(parsed)) {
      d = new Date(parsed);
      if (d.getTime() < today.getTime()) d.setFullYear(today.getFullYear() + 1); // next occurrence
    } else {
      const withYear = Date.parse(cleaned);
      if (!Number.isNaN(withYear)) d = new Date(withYear);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days === 0) return `That's today.`;
  if (days < 0) return `That was ${-days} day${-days === 1 ? '' : 's'} ago.`;
  return `${days} day${days === 1 ? '' : 's'} until ${cleaned}.`;
}

// --- dispatcher ------------------------------------------------------------

/** Try to answer a message with an instant utility, or return null. */
export function tryUtility(text: string, now = Date.now()): string | null {
  const q = text.trim();

  // Percentage: "what's 15% of 2400"
  const pct = q.match(/\b(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)/i);
  if (pct) return `${fmt((Number(pct[1]) / 100) * Number(pct[2]))}`;

  // Timezone: "3pm PST in IST"
  const tz = q.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*([a-z]{2,4})\s+(?:in|to)\s+([a-z]{2,4})\b/i);
  if (tz && TZ[tz[4].toLowerCase()] && TZ[tz[5].toLowerCase()]) {
    const r = convertZone(Number(tz[1]), Number(tz[2] ?? 0), tz[3], tz[4], tz[5]);
    if (r) return r;
  }

  // Unit conversion: "5 km in miles", "100 f to c"
  const unit = q.match(/\b(-?\d+(?:\.\d+)?)\s*(?:degrees?\s+)?([a-z]+)\s+(?:in|to|as)\s+([a-z]+)\b/i);
  if (unit) {
    const r = convertUnit(Number(unit[1]), unit[2], unit[3]);
    if (r) return r;
  }

  // Days until: "days until Aug 15"
  const du = q.match(/\b(?:how many\s+)?days?\s+(?:until|till|til|to|before)\s+(.+)/i);
  if (du) {
    const r = daysUntil(du[1], now);
    if (r) return r;
  }

  // Arithmetic: "what's 12 * 8", "(3+4)^2". Only when it's clearly a sum.
  const mathStr = q
    .replace(/^\s*(?:what(?:'s| is)?|calculate|compute|solve|=)\s*/i, '')
    .replace(/[?=\s]+$/g, '')
    .trim();
  if (/^[\d\s+\-*/^%().]+$/.test(mathStr) && /[+\-*/^%]/.test(mathStr) && /\d/.test(mathStr)) {
    const r = calc(mathStr);
    if (r !== null) return `${fmt(r)}`;
  }

  return null;
}
