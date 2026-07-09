import { DEFAULT_SETTINGS, type NomiSettings } from './types';

export const SETTINGS_KEY = 'nomi:settings';

export async function getSettings(): Promise<NomiSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] ?? {}),
    ollama: { ...DEFAULT_SETTINGS.ollama, ...(stored[SETTINGS_KEY]?.ollama ?? {}) },
    gemini: { ...DEFAULT_SETTINGS.gemini, ...(stored[SETTINGS_KEY]?.gemini ?? {}) },
  };
}

export async function saveSettings(settings: NomiSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
