/** LeetCode adapter (ADR-5 Tier 2) — the flagship. Reads exactly one
 * whitelisted DOM signal: the "Accepted" verdict after a submission. It never
 * reads code, problem text, or anything else. The background re-validates
 * everything against the contract in lib/adapters.ts before storing. */

export default defineContentScript({
  matches: ['*://leetcode.com/*'],
  runAt: 'document_idle',

  main() {
    let lastSent = { slug: '', ts: 0 };

    const slugFromUrl = (): string | null =>
      location.pathname.match(/\/problems\/([^/]+)/)?.[1] ?? null;

    const difficultyFromDom = (): string => {
      // LeetCode marks difficulty with a text-difficulty-* class; fall back
      // to scanning small badge-like nodes. Cosmetic — 'unknown' is fine.
      const el = document.querySelector('[class*="text-difficulty-"]');
      const text = el?.textContent?.trim();
      if (text === 'Easy' || text === 'Medium' || text === 'Hard') return text;
      return 'unknown';
    };

    const checkForAccepted = () => {
      const result = document.querySelector('span[data-e2e-locator="submission-result"]');
      if (!result || result.textContent?.trim() !== 'Accepted') return;
      const slug = slugFromUrl();
      if (!slug) return;
      // The result panel re-renders repeatedly; only celebrate once.
      if (slug === lastSent.slug && Date.now() - lastSent.ts < 90000) return;
      lastSent = { slug, ts: Date.now() };
      void chrome.runtime
        .sendMessage({
          type: 'nomi:signal',
          adapter: 'leetcode',
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
        checkForAccepted();
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
});
