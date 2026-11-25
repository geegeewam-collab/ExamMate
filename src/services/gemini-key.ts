import { Preferences } from '@capacitor/preferences';

/** Google AI Studio: where anyone can create a free Gemini key. */
export const AI_STUDIO_URL = 'https://aistudio.google.com/apikey';
const KEY = 'gemini_key';

/** Strips spaces and quotes people accidentally copy along with the key. */
export const cleanKey = (s: string) => s.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
export const looksLikeKey = (s: string) => /^[A-Za-z0-9_\-]{20,200}$/.test(s);
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}••••••${k.slice(-4)}` : '••••••');

const native = () => typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

/** A Gemini key the student has copied, or '' (nothing copied, not a key, or the clipboard is unavailable). Never throws. */
export async function copiedKey(): Promise<string> {
  try {
    let text = '';
    if (native()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      text = (await Clipboard.read()).value || '';
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      text = await navigator.clipboard.readText();
    }
    const k = cleanKey(text);
    return looksLikeKey(k) ? k : '';
  } catch {
    return '';
  }
}

/** Opens AI Studio inside the app (a Chrome tab sheet) and calls `onClosed` when the student comes back. */
export async function openAiStudio(onClosed: () => void): Promise<void> {
  if (!native()) {
    window.open(AI_STUDIO_URL, '_blank', 'noopener');
    return;
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    const handle = await Browser.addListener('browserFinished', () => {
      void handle.remove();
      onClosed();
    });
    await Browser.open({ url: AI_STUDIO_URL, presentationStyle: 'popover' });
  } catch {
    window.open(AI_STUDIO_URL, '_blank', 'noopener');
  }
}

export const GeminiKey = {
  async get(): Promise<string> {
    return (await Preferences.get({ key: KEY })).value || '';
  },
  async set(k: string) {
    await Preferences.set({ key: KEY, value: k });
  },
  async clear() {
    await Preferences.remove({ key: KEY });
  },

  /** Asks Google directly (not our server) whether the key is accepted. */
  async check(k: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': k } });
      if (r.ok || r.status === 429) return { ok: true }; // 429 = key is real, just busy
      if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, error: 'Google did not accept that key. Copy it again from AI Studio and paste it here.' };
      return { ok: false, error: `Google replied with an error (${r.status}). Try again in a moment.` };
    } catch {
      return { ok: false, error: 'Could not reach Google. Check your internet connection and try again.' };
    }
  },
};
