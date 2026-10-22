import type { Speech } from './engine';

/* ---------- Speech ---------- */
export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

let keepRef: SpeechSynthesisUtterance | null = null; // Chrome can garbage-collect a playing utterance and drop onend

export function createWebSpeech(): Speech {
  return {
    speak(text, { rate, voiceURI }, h) {
      if (!speechSupported()) {
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
      if (speechSupported()) window.speechSynthesis.cancel();
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

export interface VoiceOption { uri: string; label: string }

/** Installed voices, with the phone's language first. Calls back again if the list loads late. */
export function watchVoices(cb: (v: VoiceOption[]) => void): () => void {
  if (!speechSupported()) return () => {};
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
export const primeSpeech = () => createWebSpeech().prime?.();
