import type { Speech } from './engine';

/* ---------- Speech ---------- */
/** The phone's language as a clean BCP-47 tag ("en-US"), whatever odd value the system reports. */
export function deviceLang(raw = typeof navigator !== 'undefined' ? navigator.language : ''): string {
  const t = String(raw || '').replace(/[@.].*$/, '').replace(/_/g, '-');
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(t) ? t : 'en-US';
}
export const isNative = () => typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
const hasWebSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
/** The Android app's web view has no browser speech; there it uses Android's own text-to-speech through a plugin. */
export const speechSupported = () => isNative() || hasWebSpeech();

let keepRef: SpeechSynthesisUtterance | null = null; // Chrome can garbage-collect a playing utterance and drop onend

export function createWebSpeech(): Speech {
  return {
    speak(text, { rate, voiceURI }, h) {
      if (!hasWebSpeech()) {
        h.onerror('unsupported');
        return;
      }
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      if (voiceURI) {
        const v = synth.getVoices().find((x) => x.voiceURI === voiceURI);
        if (v) {
          u.voice = v;
          u.lang = v.lang;
        }
      }
      u.onstart = () => h.onstart();
      u.onend = () => h.onend();
      u.onerror = (e) => h.onerror(e.error);
      keepRef = u;
      synth.speak(u);
    },
    cancel() {
      if (hasWebSpeech()) window.speechSynthesis.cancel();
    },
    prime() {
      try {
        const p = new SpeechSynthesisUtterance(' ');
        p.volume = 0;
        window.speechSynthesis.speak(p);
      } catch {
        /* ignore */
      }
    },
  };
}

/* ---- Android: system text-to-speech via @capacitor-community/text-to-speech ---- */
export interface NativeTTS {
  speak(o: { text: string; lang: string; rate: number; pitch: number; volume: number; queueStrategy: number }): Promise<void>;
  stop(): Promise<void>;
  isLanguageSupported(o: { lang: string }): Promise<{ supported: boolean }>;
}

export function createNativeSpeech(load: () => Promise<NativeTTS | null>, preferred: string[]): Speech {
  let lang: Promise<string> | null = null;
  const pick = (T: NativeTTS) =>
    (lang ??= (async () => {
      for (const l of preferred) {
        try { if ((await T.isLanguageSupported({ lang: l })).supported) return l; } catch { /* try the next */ }
      }
      return preferred[preferred.length - 1];
    })());
  return {
    speak(text, { rate }, h) {
      void (async () => {
        const T = await load();
        if (!T) return h.onerror('unsupported');
        const l = await pick(T);
        h.onstart(); // the plugin has no "started" event
        try {
          await T.speak({ text, lang: l, rate: Math.min(2, Math.max(0.1, rate)), pitch: 1, volume: 1, queueStrategy: 0 /* flush: replace what is playing */ });
          h.onend();
        } catch (e) {
          const m = String((e as any)?.message ?? e);
          h.onerror(/not.*(available|supported|installed)|unavailable|not initiali|no .*engine/i.test(m) ? 'unsupported' : m || 'error');
        }
      })();
    },
    cancel() { void load().then((T) => T?.stop()).catch(() => undefined); },
    prime() { void load(); },
  };
}

const loadNativeTTS = (() => {
  let p: Promise<NativeTTS | null> | null = null;
  return () => (p ??= import('@capacitor-community/text-to-speech').then((m) => m.TextToSpeech as unknown as NativeTTS).catch(() => null));
})();

/** The right speech engine for where the app is running. */
export function createSpeech(): Speech {
  if (!isNative()) return createWebSpeech();
  const nav = deviceLang();
  return createNativeSpeech(loadNativeTTS, [...new Set([nav, nav.split('-')[0], 'en-US'])]);
}

export interface VoiceOption { uri: string; label: string }

/** Installed voices, with the phone's language first. Calls back again if the list loads late. */
export function watchVoices(cb: (v: VoiceOption[]) => void): () => void {
  if (!hasWebSpeech()) return () => {}; // the Android app uses the phone's own voice and has no list to show
  const synth = window.speechSynthesis;
  const load = () => {
    const all = synth.getVoices();
    if (!all.length) return;
    const lang = (navigator.language || 'en').slice(0, 2);
    const sorted = [...all].sort(
      (a, b) => Number(b.lang.startsWith(lang)) - Number(a.lang.startsWith(lang)) || a.name.localeCompare(b.name),
    );
    cb(sorted.map((v) => ({ uri: v.voiceURI, label: `${v.name} (${v.lang})${v.localService ? ' · offline' : ''}` })));
  };
  synth.addEventListener('voiceschanged', load);
  load();
  return () => synth.removeEventListener('voiceschanged', load);
}

/* ---------- Screen wake lock ---------- */
let lock: WakeLockSentinel | null = null;
export async function wake() {
  try {
    if ('wakeLock' in navigator && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
      });
    }
  } catch {
    /* ignore */
  }
}
export function unwake() {
  try {
    lock?.release();
  } catch {
    /* ignore */
  }
  lock = null;
}

/* ---------- Keep-alive audio: stops the phone from suspending speech when the screen locks ---------- */
let ka: HTMLAudioElement | null = null;
let kaWanted = false;

function makeKeepAlive(): HTMLAudioElement {
  const sr = 8000, n = sr;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true);
  b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(40 * Math.sin((2 * Math.PI * 25 * i) / sr)), true);
  const a = new Audio();
  a.loop = true;
  a.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  a.addEventListener('pause', () => {
    if (kaWanted) a.play().catch(() => {});
  });
  return a;
}
export function startKeepAlive() {
  kaWanted = true;
  try {
    (ka ??= makeKeepAlive()).play().catch(() => {});
  } catch {
    /* ignore */
  }
}
export function stopKeepAlive() {
  kaWanted = false;
  try {
    ka?.pause();
  } catch {
    /* ignore */
  }
}

/* ---------- Earbud / lock-screen controls ---------- */
export interface MediaHandlers {
  active(): boolean;
  hasText(): boolean;
  startFromText(): void;
  toggle(): void;
  next(): void;
  back(): void;
  repeat(): void;
  /** Optional: return true if the gesture was used to ask a question. */
  ask?(): boolean;
}

export function bindMediaSession(h: MediaHandlers): () => void {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!ms) return () => {};
  let lastPrev = 0;
  const handlers: Partial<Record<MediaSessionAction, () => void>> = {
    play: () => h.toggle(),
    pause: () => h.toggle(),
    nexttrack: () => h.next(),
    seekforward: () => h.next(),
    seekbackward: () => h.back(),
    previoustrack: () => {
      if (h.ask?.()) return;
      const t = Date.now();
      if (t - lastPrev < 1500) h.back();
      else h.repeat();
      lastPrev = t;
    },
  };
  (Object.keys(handlers) as MediaSessionAction[]).forEach((a) => {
    try {
      ms.setActionHandler(a, () => {
        if (!h.active()) {
          if ((a === 'play' || a === 'pause') && h.hasText()) h.startFromText();
          return;
        }
        handlers[a]!();
      });
    } catch {
      /* action unsupported */
    }
  });
  return () => {
    (Object.keys(handlers) as MediaSessionAction[]).forEach((a) => {
      try {
        ms.setActionHandler(a, null);
      } catch {
        /* ignore */
      }
    });
  };
}

export function setMediaInfo(title: string, album: string, playing: boolean | null) {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!ms) return;
  try {
    if (typeof MediaMetadata !== 'undefined') ms.metadata = new MediaMetadata({ title, artist: 'Exam Mate', album });
    ms.playbackState = playing === null ? 'none' : playing ? 'playing' : 'paused';
  } catch {
    /* ignore */
  }
}

/** Unlocks speech on mobile; call from a tap before speaking later. */
export const primeSpeech = () => createSpeech().prime?.();
