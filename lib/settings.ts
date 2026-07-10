import { DEFAULT_SETTINGS, type NomiSettings } from './types';

export const SETTINGS_KEY = 'nomi:settings';

export async function getSettings(): Promise<NomiSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const gemini = { ...DEFAULT_SETTINGS.gemini, ...(stored[SETTINGS_KEY]?.gemini ?? {}) };
  // A stored-but-empty key means the user never entered one: let the
  // .env-seeded default (if any) take over so chat works out of the box.
  if (!gemini.apiKey && DEFAULT_SETTINGS.gemini.apiKey) {
    gemini.apiKey = DEFAULT_SETTINGS.gemini.apiKey;
    gemini.enabled = true;
  }
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] ?? {}),
    ollama: { ...DEFAULT_SETTINGS.ollama, ...(stored[SETTINGS_KEY]?.ollama ?? {}) },
    gemini,
  };
}

export async function saveSettings(settings: NomiSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
