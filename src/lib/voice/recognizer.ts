/** Speech recognition behind one small interface: the browser Web Speech API, or the native Speech framework / Android SpeechRecognizer through Capacitor. */

export type EndReason = 'ended' | 'no-speech' | 'denied' | 'unavailable' | 'error';

export interface RecognizerHandlers {
  /** Called once when the microphone is really open (so a "ding" means "speak now" and no words are lost). */
  onReady?(): void;
  /** Called with the latest transcript (interim while speaking, final when the engine is sure). */
  /** `segment` numbers the utterance inside one session (the browser keeps one session open and numbers each phrase). Absent when the engine does not say. */
  onText(text: string, final: boolean, segment?: number): void;
  /** Called once when this listening session is over. */
  onEnd(reason: EndReason, detail?: string): void;
}

export interface Recognizer {
  readonly kind: 'web' | 'native';
  available(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  start(h: RecognizerHandlers): Promise<void>;
  stop(): Promise<void>;
}

/* ---------------- browser (Chrome, installed web app) ---------------- */
export function createWebRecognizer(w: any, lang: string): Recognizer | null {
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  let rec: any = null;
  return {
    kind: 'web',
    async available() {
      return true;
    },
    async requestPermission() {
      try {
        const s = await w.navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t: any) => t.stop());
        return true;
      } catch {
        return false;
      }
    },
    async start(h) {
      try { rec?.abort?.(); } catch { /* ignore */ }
      const r = new Ctor();
      rec = r;
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      let ended = false;
      let ready = false;
      const end = (reason: EndReason, detail?: string) => {
        if (ended) return;
        ended = true;
        h.onEnd(reason, detail);
      };
      const markReady = () => { if (!ready) { ready = true; h.onReady?.(); } };
      r.onaudiostart = markReady;
      r.onstart = markReady;
      r.onresult = (e: any) => {
        markReady();
        const res = e.results[e.results.length - 1];
        if (res && res[0]) h.onText(String(res[0].transcript), !!res.isFinal, e.results.length - 1);
      };
      r.onerror = (e: any) => {
        const c = String(e.error || '');
        end(c === 'not-allowed' || c === 'service-not-allowed' ? 'denied' : c === 'no-speech' ? 'no-speech' : c === 'aborted' ? 'ended' : 'error', c);
      };
      r.onend = () => end('ended');
      r.start();
    },
    /** Resolves once the session has really closed (or after 600 ms), so the next one never overlaps it. */
    async stop() {
      const r = rec;
      if (!r) return;
      await new Promise<void>((res) => {
        const t = setTimeout(res, 600);
        const prev = r.onend;
        r.onend = (...a: unknown[]) => { clearTimeout(t); try { prev?.(...a); } finally { res(); } };
        try { r.stop(); } catch { clearTimeout(t); res(); }
      });
    },
  };
}

/* ---------------- iOS + Android app (Capacitor native speech-recognition plugin) ---------------- */
export interface NativePlugin {
  available(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<any>;
  start(o: any): Promise<any>;
  stop(): Promise<void>;
  forceStop?(options?: { timeout?: number }): Promise<void>;
  addListener(ev: string, cb: (d: any) => void): Promise<{ remove(): Promise<void> }>;
  checkPermissions?(): Promise<any>;
  getSupportedLanguages?(): Promise<{ languages: string[] }>;
}

/** Prefer an exact device locale, then a regional variant of the same base language. Never silently switch to a different language. */
export function matchRecognitionLocale(requested: string, supported: string[]): string | null {
  const canonical = (value: string) => String(value || '').replace(/_/g, '-').toLowerCase();
  const target = canonical(requested);
  const exact = supported.find((value) => canonical(value) === target);
  if (exact) return exact;
  const base = target.split('-')[0];
  return supported.find((value) => canonical(value).split('-')[0] === base) ?? null;
}

export function createNativeRecognizer(SR: NativePlugin, lang: string): Recognizer {
  let handles: { remove(): Promise<void> }[] = [];
  let resolvedLanguage: Promise<string | null> | null = null;
  const recognitionLanguage = () => (resolvedLanguage ??= (async () => {
    try {
      const supported = await SR.getSupportedLanguages?.();
      if (supported?.languages?.length) return matchRecognitionLocale(lang, supported.languages);
    } catch { /* older plugin builds may not expose locale enumeration */ }
    return lang;
  })());
  const clean = async () => {
    for (const h of handles) { try { await h.remove(); } catch { /* ignore */ } }
    handles = [];
  };
  return {
    kind: 'native',
    async available() {
      try {
        const language = await recognitionLanguage();
        return !!language && !!(await SR.available()).available;
      } catch { return false; }
    },
    async requestPermission() {
      try {
        const r = await SR.requestPermissions();
        const v = String(r?.speechRecognition ?? '').toLowerCase();
        return v === 'granted';
      } catch { return false; }
    },
    async start(h) {
      await clean();
      let ended = false;
      const language = await recognitionLanguage();
      if (!language) { h.onEnd('unavailable', `Speech recognition does not support ${lang} on this device.`); return; }
      const end = (reason: EndReason, detail?: string) => {
        if (ended) return;
        ended = true;
        void clean();
        h.onEnd(reason, detail);
      };
      handles.push(await SR.addListener('partialResults', (d) => {
        if (ended) return;
        const t = d?.accumulatedText || d?.accumulated || d?.matches?.[0];
        if (t) h.onText(String(t), false, 0);
      }));
      handles.push(await SR.addListener('listeningState', (d) => {
        if (ended) return;
        const state = String(d?.status ?? d?.state ?? '').toLowerCase();
        const reason = String(d?.reason ?? '').toLowerCase();
        if (state === 'started') h.onReady?.();
        if (state === 'stopped' || state === 'ended') end(reason === 'silence' ? 'no-speech' : reason === 'error' ? 'error' : 'ended', reason || undefined);
      }));
      handles.push(await SR.addListener('error', (d) => {
        const code = String(d?.errorCode ?? d?.code ?? d?.error ?? d?.message ?? d?.errorMessage ?? '');
        const lower = code.toLowerCase();
        end(/permission|denied|not authorized/.test(lower) ? 'denied' : /no[\s_-]?speech/.test(lower) ? 'no-speech' : /unavailable|not[\s_-]?available|not[\s_-]?supported|unsupported|language.*(missing|unsupported)/.test(lower) ? 'unavailable' : 'error', code);
      }));
      try {
        const res = await SR.start({ language, maxResults: 1, partialResults: true, popup: false });
        const t = res?.accumulatedText || res?.matches?.[0];
        if (t && !ended) h.onText(String(t), false, 0);
      } catch (e) {
        const m = String((e as any)?.message || e);
        end(/permission|denied|not authorized/i.test(m) ? 'denied' : /not[\s_-]?available|unavailable|not[\s_-]?supported|unsupported|language.*(missing|unsupported)/i.test(m) ? 'unavailable' : 'error', m);
      }
    },
    async stop() {
      try {
        if (SR.forceStop) await SR.forceStop({ timeout: 1500 });
        else await SR.stop();
      } catch {
        try { await SR.stop(); } catch { /* native session may already be closed */ }
      }
    },
  };
}

/** Selects the native speech engine on Capacitor iOS/Android, otherwise the browser implementation. */
export async function createRecognizer(lang = 'en-US'): Promise<Recognizer | null> {
  if (typeof window === 'undefined') return null;
  const native = !!(window as any).Capacitor?.isNativePlatform?.();
  if (native) {
    try {
      const mod = await import('@capgo/capacitor-speech-recognition');
      const r = createNativeRecognizer(mod.SpeechRecognition as unknown as NativePlugin, lang);
      return (await r.available()) ? r : null;
    } catch {
      return null;
    }
  }
  return createWebRecognizer(window, lang);
}
