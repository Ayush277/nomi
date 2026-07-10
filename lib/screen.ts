/** Reads the meaningful, visible text of a page so Nomi can actually answer
 * "what's on my screen?" / "explain this". Runs only in the content script
 * (needs the live DOM). Privacy: headings and body prose only — NEVER input
 * values, passwords, or hidden nodes. The background gates this behind the
 * same sensitive-site rules as everything else before it's ever requested. */

const SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'ASIDE', 'FORM',
  'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SVG', 'CANVAS', 'IFRAME',
]);

const WANTED = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'LI', 'PRE', 'CODE', 'BLOCKQUOTE', 'TD', 'DD', 'DT']);

function isVisible(el: Element, view: Window): boolean {
  const cs = view.getComputedStyle?.(el as HTMLElement);
  if (!cs) return true; // no style engine (shouldn't happen in a page) — keep it
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}

export interface ScreenSnapshot {
  title: string;
  heading: string;
  text: string;
}

export function extractVisibleText(doc: Document, maxChars = 2000): ScreenSnapshot {
  // NodeFilter / Node are globals in a real page but not in Node.js tests —
  // source them from the document's own window so both work.
  const view = (doc.defaultView ?? (globalThis as unknown as Window)) as Window & typeof globalThis;
  const NF = view.NodeFilter;
  const TEXT_NODE = view.Node.TEXT_NODE;

  const root = doc.querySelector('main, article, [role="main"]') ?? doc.body;
  const title = (doc.title ?? '').slice(0, 160).trim();
  const heading = doc.querySelector('h1')?.textContent?.trim().slice(0, 160) ?? '';

  const parts: string[] = [];
  let total = 0;
  const walker = doc.createTreeWalker(root, NF.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (SKIP.has(el.tagName)) return NF.FILTER_REJECT;
      if (el.getAttribute('aria-hidden') === 'true') return NF.FILTER_REJECT;
      if (!WANTED.has(el.tagName)) return NF.FILTER_SKIP;
      return NF.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node && total < maxChars) {
    const el = node as Element;
    if (isVisible(el, view)) {
      // Direct text of this block only (children are visited separately).
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (own.length > 1) {
        const line = /^H[1-6]$/.test(el.tagName) ? `\n## ${own}` : own;
        parts.push(line);
        total += line.length;
      }
    }
    node = walker.nextNode();
  }

  return { title, heading, text: parts.join('\n').slice(0, maxChars).trim() };
}

/** One-line summary for the "what Nomi can see" panel + system prompt. */
export function describeSnapshot(domain: string, snap: ScreenSnapshot): string {
  const head = snap.heading || snap.title;
  return head ? `${domain} — "${head}"` : domain;
}
