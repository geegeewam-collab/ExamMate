/** Speech recognition behind one small interface: the browser's Web Speech API, or a native plugin inside the Android app. */

export type EndReason = 'ended' | 'no-speech' | 'denied' | 'unavailable' | 'error';

export interface RecognizerHandlers {
  /** Called with the latest transcript (interim while speaking, final when the engine is sure). */
  onText(text: string, final: boolean): void;
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
      const end = (reason: EndReason, detail?: string) => {
        if (ended) return;
        ended = true;
        h.onEnd(reason, detail);
      };
      r.onresult = (e: any) => {
        const res = e.results[e.results.length - 1];
        if (res && res[0]) h.onText(String(res[0].transcript), !!res.isFinal);
      };
      r.onerror = (e: any) => {
        const c = String(e.error || '');
        end(c === 'not-allowed' || c === 'service-not-allowed' ? 'denied' : c === 'no-speech' ? 'no-speech' : c === 'aborted' ? 'ended' : 'error', c);
      };
      r.onend = () => end('ended');
      r.start();
    },
    async stop() {
      try { rec?.stop(); } catch { /* ignore */ }
    },
  };
}

/* ---------------- Android app (Capacitor speech-recognition plugin) ---------------- */
export interface NativePlugin {
  available(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<any>;
  start(o: any): Promise<any>;
  stop(): Promise<void>;
  addListener(ev: string, cb: (d: any) => void): Promise<{ remove(): Promise<void> }>;
}

export function createNativeRecognizer(SR: NativePlugin, lang: string): Recognizer {
  let handles: { remove(): Promise<void> }[] = [];
  const clean = async () => {
    for (const h of handles) { try { await h.remove(); } catch { /* ignore */ } }
    handles = [];
  };
  return {
    kind: 'native',
    async available() {
      try { return !!(await SR.available()).available; } catch { return false; }
    },
    async requestPermission() {
      try {
        const r = await SR.requestPermissions();
        const v = r?.speechRecognition;
        return v === undefined ? true : v === 'granted';
      } catch { return false; }
    },
    async start(h) {
      await clean();
      let ended = false;
      const end = (reason: EndReason, detail?: string) => {
        if (ended) return;
        ended = true;
        void clean();
        h.onEnd(reason, detail);
      };
      handles.push(await SR.addListener('partialResults', (d) => {
        const t = d?.matches?.[0];
        if (t) h.onText(String(t), false);
      }));
      handles.push(await SR.addListener('listeningState', (d) => {
        if (d?.status === 'stopped') end('ended');
      }));
      try {
        const res = await SR.start({ language: lang, maxResults: 1, partialResults: true, popup: false });
        const t = res?.matches?.[0];
        if (t) h.onText(String(t), true); // some versions return the final text here
      } catch (e) {
        const m = String((e as any)?.message || e);
        end(/permission|denied/i.test(m) ? 'denied' : 'error', m);
      }
    },
    async stop() {
      try { await SR.stop(); } catch { /* ignore */ }
    },
  };
}

/** Picks the right recognizer for where the app is running, or null if voice is not possible here. */
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
