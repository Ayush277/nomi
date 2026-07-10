import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // 3000 is taken by another app on this machine.
  dev: {
    server: { port: 3001 },
  },
  runner: {
    // Open somewhere the widget can actually mount (it never runs on chrome:// pages).
    startUrls: ['https://github.com/trending'],
    // No Chrome installed on this machine; use ARM-native Chrome for Testing.
    binaries: {
      chrome:
        `${process.env.HOME}/.cache/nomi-browsers/chrome/mac_arm-150.0.7871.115/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    },
  },
  manifest: {
    name: 'Nomi',
    description: 'Your digital companion that quietly understands your day.',
    // tabs/idle/alarms/storage: the minimum needed for site awareness (ADR-5 Tier 1).
    // <all_urls> is required so the companion widget can live on every page (ADR-1).
    permissions: ['storage', 'tabs', 'idle', 'alarms', 'offscreen'],
    host_permissions: ['<all_urls>'],
    // onnxruntime (local Whisper) needs wasm in extension pages.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    commands: {
      'talk-to-nomi': {
        suggested_key: { default: 'Alt+Shift+N' },
        description: 'Talk to Nomi (opens chat with voice input)',
      },
    },
  },
});
