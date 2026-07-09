import ReactDOM from 'react-dom/client';
import { Widget } from './Widget';
import './widget.css';

/** Spike B (ADR-6): the companion mounts into a Shadow DOM on every page so
 * site CSS can't touch it and its CSS can't touch the site. The wrapper is
 * pointer-events:none — only the orb itself is interactive, so Nomi can
 * never block page content. */
export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'nomi-companion',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<Widget />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();
  },
});
