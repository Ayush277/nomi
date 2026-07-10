/** YouTube adapter (ADR-5 Tier 2): one whitelisted signal — the title and
 * channel of a video you actually watch — so memory can answer "when did I
 * watch that DP tutorial?". Nothing else is read from the page. */

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  runAt: 'document_idle',

  main(ctx) {
    // Detects extension reloads so the orphaned observer stands down quietly.
    ctx.setInterval(() => {}, 8000);
    let lastVideo = '';

    const check = () => {
      if (!location.pathname.startsWith('/watch')) return;
      // Video id is only used in-page to dedupe SPA navigations; never sent.
      const videoId = new URLSearchParams(location.search).get('v') ?? location.pathname;
      if (videoId === lastVideo) return;

      const title = (
        document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent ??
        document.title.replace(/ - YouTube$/, '')
      ).trim();
      if (!title || title === 'YouTube') return;
      const channel =
        document.querySelector('ytd-channel-name#channel-name a')?.textContent?.trim() ?? '';

      lastVideo = videoId;
      void chrome.runtime
        .sendMessage({
          type: 'nomi:signal',
          adapter: 'youtube',
          kind: 'video_watch',
          data: { title: title.slice(0, 160), channel: channel.slice(0, 100) },
        })
        .catch(() => {});
    };

    // YouTube is a SPA; it announces navigations with its own event.
    window.addEventListener('yt-navigate-finish', () => setTimeout(check, 1200));
    setTimeout(check, 2500);
  },
});
