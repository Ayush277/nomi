/** GeeksforGeeks adapter (ADR-5 Tier 2) — same shape as the LeetCode one.
 * Reads exactly one whitelisted DOM signal: the "solved" verdict after a
 * practice submission. It never reads code, problem text, or anything else.
 * The background re-validates everything against lib/adapters.ts before
 * storing. NOTE: GfG's result markup changes over time; if celebrations stop
 * firing, the success-verdict text/selector below is the thing to update. */

export default defineContentScript({
  matches: ['*://*.geeksforgeeks.org/*'],
  runAt: 'document_idle',

  main(ctx) {
    // Detects extension reloads so the orphaned observer stands down quietly.
    ctx.setInterval(() => {}, 8000);
    let lastSent = { slug: '', ts: 0 };

    // Practice problems live at /problems/<slug>/1 — only those can be "solved".
    const slugFromUrl = (): string | null =>
      location.pathname.match(/\/problems\/([^/]+)/)?.[1] ?? null;

    const difficultyFromDom = (): string => {
      // GfG shows the level in a small badge; cosmetic, 'unknown' is fine.
      const text = Array.from(document.querySelectorAll('span, div'))
        .map((el) => el.textContent?.trim())
        .find((t) => t && ['School', 'Basic', 'Easy', 'Medium', 'Hard'].includes(t));
      return text ?? 'unknown';
    };

    // The verdict GfG shows when every test case passes.
    const SOLVED = /problem solved successfully|correct answer|all test cases passed/i;

    const checkForSolved = () => {
      // Scan only short result-panel-sized nodes so we don't sweep the page.
      const hit = Array.from(document.querySelectorAll('div, span, p, h1, h2, h3')).some(
        (el) => {
          const t = el.textContent?.trim() ?? '';
          return t.length < 80 && SOLVED.test(t);
        },
      );
      if (!hit) return;
      const slug = slugFromUrl();
      if (!slug) return;
      // The result panel re-renders repeatedly; only celebrate once.
      if (slug === lastSent.slug && Date.now() - lastSent.ts < 90000) return;
      lastSent = { slug, ts: Date.now() };
      void chrome.runtime
        .sendMessage({
          type: 'nomi:signal',
          adapter: 'geeksforgeeks',
          kind: 'submission_accepted',
          data: { slug, difficulty: difficultyFromDom() },
        })
        .catch(() => {});
    };

    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        checkForSolved();
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());
  },
});
