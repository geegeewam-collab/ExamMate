import type { Speech } from './engine';

/* ---------- Speech ---------- */
/** The phone's language as a clean BCP-47 tag ("en-US"), whatever odd value the system reports. */
export function deviceLang(raw = typeof navigator !== 'undefined' ? navigator.language : ''): string {
  const t = String(raw || '').replace(/[@.].*$/, '').replace(/_/g, '-');
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(t) ? t : 'en-US';
}
export const isNative = () => typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
export const isAndroidNative = () => isNative() && (window as any).Capacitor?.getPlatform?.() === 'android';
const hasWebSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
/** Native iOS and Android use the Capacitor TTS plugin; web builds use Web Speech. */
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
  speak(o: { text: string; lang: string; rate: number; pitch: number; volume: number; queueStrategy: number; category?: 'ambient' | 'playback' }): Promise<void>;
  stop(): Promise<void>;
  isLanguageSupported(o: { lang: string }): Promise<{ supported: boolean }>;
  getSupportedLanguages?(): Promise<{ languages: string[] }>;
  openInstall?(): Promise<void>;
}

export function createNativeSpeech(load: () => Promise<NativeTTS | null>, preferred: string[]): Speech {
  let languagePromise: Promise<string> | null = null;
  const chooseLanguage = async (tts: NativeTTS): Promise<string> => {
    const available: string[] = [];
    try { available.push(...((await tts.getSupportedLanguages?.())?.languages ?? [])); } catch { /* use per-locale probing below */ }
    const canonical = (value: string) => value.toLowerCase().replace(/_/g, '-');
    for (const candidate of preferred) {
      const actual = available.find((value) => canonical(value) === canonical(candidate))
        ?? available.find((value) => canonical(value).split('-')[0] === canonical(candidate).split('-')[0]);
      if (actual) return actual;
      try { if ((await tts.isLanguageSupported({ lang: candidate })).supported) return candidate; } catch { /* try the next locale */ }
    }
    if (available.length) {
      throw new Error('No compatible speech voice is installed for your device language. Install a voice for that language in your device speech settings, then retry.');
    }
    throw new Error('No speech engine or compatible language voice is installed. Enable a text-to-speech engine in your device settings, then retry.');
  };
  const pickLanguage = (tts: NativeTTS): Promise<string> => {
    if (!languagePromise) {
      languagePromise = chooseLanguage(tts).catch((error) => {
        // Do not cache failures: a user may install a voice in Settings and retry without restarting Exam Mate.
        languagePromise = null;
        throw error;
      });
    }
    return languagePromise;
  };

  return {
    speak(text, { rate }, h) {
      void (async () => {
        const tts = await load();
        if (!tts) {
          if (hasWebSpeech()) return createWebSpeech().speak(text, { rate, voiceURI: '' }, h);
          return h.onerror('unsupported');
        }
        try {
          const lang = await pickLanguage(tts);
          const speaking = tts.speak({
            text, lang, rate: Math.min(2, Math.max(0.1, rate)), pitch: 1, volume: 1,
            queueStrategy: 0, category: 'playback',
          });
          // The native plugin resolves when the utterance finishes; it does not expose onStart.
          h.onstart();
          await speaking;
          h.onend();
        } catch (error) {
          const message = String((error as any)?.message ?? error);
          h.onerror(/no speech|compatible speech voice|no .*engine|not.*(available|supported|installed)|unavailable|not initiali|language.*not/i.test(message) ? 'unsupported' : message || 'error');
        }
      })();
    },
    cancel() { void load().then((tts) => tts?.stop()).catch(() => undefined); },
    prime() { void load(); },
  };
}

const loadNativeTTS = (() => {
  let p: Promise<NativeTTS | null> | null = null;
  return () => (p ??= import('@capacitor-community/text-to-speech').then((m) => m.TextToSpeech as unknown as NativeTTS).catch(() => null));
})();

/** Opens Android's system TTS voice-data installer when a required voice is missing. */
export async function openNativeSpeechInstall(): Promise<boolean> {
  if (!isAndroidNative()) return false;
  const tts = await loadNativeTTS();
  if (!tts?.openInstall) return false;
  await tts.openInstall();
  return true;
}

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

/* ---------- Native and browser media controls ---------- */
export interface MediaHandlers {
  active(): boolean;
  hasText(): boolean;
  startFromText(): void;
  toggle(): void;
  play(): void;
  pause(): void;
  next(): void;
  back(): void;
  repeat(): void;
  /** Start voice capture from a headset shortcut. */
  ask?(): void;
  /** Whether a headset play/pause press should open Ask instead of pausing active reading. */
  askOnPlayPause?: () => boolean;
  /** Current reader state, used to distinguish an Ask press while reading from Resume while paused. */
  isPlaying(): boolean;
}

interface NativeMediaPlugin {
  activate(): Promise<void>;
  update(o: { title: string; subtitle: string; playing: boolean; active: boolean }): Promise<void>;
  deactivate(): Promise<void>;
  getAudioRoutes(): Promise<{ inputs: string[]; outputs: string[] }>;
  addListener(eventName: 'mediaAction', listener: (event: { action: string }) => void): Promise<{ remove(): Promise<void> }>;
}

let NativeMedia: NativeMediaPlugin | null = null;
let nativeMediaLoad: Promise<NativeMediaPlugin | null> | null = null;
let nativeMediaReady = false;

async function loadNativeMedia(): Promise<NativeMediaPlugin | null> {
  if (!nativeMediaLoad) {
    nativeMediaLoad = import('@capacitor/core')
      .then(({ registerPlugin }) => registerPlugin<NativeMediaPlugin>('ExamMateMedia'))
      .catch((error) => {
        console.warn('[ExamMate] Native media bridge is not installed.');
        return null;
      });
  }
  return nativeMediaLoad;
}
let pendingMediaInfo = { title: 'Exam Mate', subtitle: '', playing: false, active: false };

export function routeMediaAction(action: string, h: MediaHandlers) {
  switch (action) {
    case 'play':
      if (!h.active() && h.hasText()) h.startFromText();
      else if (h.active() && h.isPlaying() && h.askOnPlayPause?.() && h.ask) h.ask();
      else h.play();
      break;
    case 'pause':
      if (h.active() && h.isPlaying() && h.askOnPlayPause?.() && h.ask) h.ask();
      else h.pause();
      break;
    case 'toggle': case 'playpause':
      if (!h.active() && h.hasText()) h.startFromText();
      else if (h.active() && h.isPlaying() && h.askOnPlayPause?.() && h.ask) h.ask();
      else h.toggle();
      break;
    case 'next': case 'nexttrack': case 'fastforward': case 'seekforward': h.next(); break;
    case 'previous': case 'previoustrack': case 'back': h.back(); break;
    case 'rewind': case 'seekbackward': case 'repeat': h.repeat(); break;
  }
}

export function bindMediaSession(h: MediaHandlers): () => void {
  let disposed = false;
  let nativeListener: { remove(): Promise<void> } | null = null;

  if (isNative()) {
    void (async () => {
      try {
        const plugin = await loadNativeMedia();
        if (!plugin) throw new Error('Native media plugin is not registered. Run Capacitor sync for this platform.');
        NativeMedia = plugin;
        nativeListener = await plugin.addListener('mediaAction', (event) => {
          if (!disposed) routeMediaAction(event.action, h);
        });
        if (disposed) { await nativeListener.remove(); nativeListener = null; return; }
        await plugin.activate();
        if (disposed) { await plugin.deactivate(); return; }
        nativeMediaReady = true;
        await plugin.update(pendingMediaInfo);
      } catch (error) {
        nativeMediaReady = false;
        console.warn('[ExamMate] Native media controls unavailable', error);
      }
    })();
    return () => {
      disposed = true;
      nativeMediaReady = false;
      void nativeListener?.remove().catch(() => undefined);
      if (NativeMedia) void NativeMedia.deactivate().catch(() => undefined);
    };
  }

  const mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!mediaSession?.setActionHandler) return () => {};
  const actions: Partial<Record<MediaSessionAction, () => void>> = {
    play: () => routeMediaAction('play', h),
    pause: () => routeMediaAction('pause', h),
    nexttrack: () => routeMediaAction('next', h),
    seekforward: () => routeMediaAction('seekforward', h),
    seekbackward: () => routeMediaAction('seekbackward', h),
    previoustrack: () => routeMediaAction('previous', h),
  };
  (Object.keys(actions) as MediaSessionAction[]).forEach((action) => {
    try { mediaSession.setActionHandler(action, actions[action]!); } catch { /* unsupported browser action */ }
  });
  return () => {
    disposed = true;
    (Object.keys(actions) as MediaSessionAction[]).forEach((action) => {
      try { mediaSession.setActionHandler(action, null); } catch { /* ignore */ }
    });
  };
}

export function setMediaInfo(title: string, album: string, playing: boolean | null) {
  pendingMediaInfo = { title, subtitle: album, playing: !!playing, active: playing !== null };
  if (isNative()) {
    if (nativeMediaReady && NativeMedia) void NativeMedia.update(pendingMediaInfo).catch(() => undefined);
    return;
  }
  const mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!mediaSession) return;
  try {
    if (typeof MediaMetadata !== 'undefined') mediaSession.metadata = new MediaMetadata({ title, artist: 'Exam Mate', album });
    mediaSession.playbackState = playing === null ? 'none' : playing ? 'playing' : 'paused';
  } catch { /* browser metadata is optional */ }
}

/** Read the OS-selected input/output routes. This never pairs or changes the user's audio devices. */
export async function getAudioRoutes(): Promise<{ inputs: string[]; outputs: string[] } | null> {
  if (!isNative()) return null;
  try { const plugin = NativeMedia ?? await loadNativeMedia(); return plugin ? await plugin.getAudioRoutes() : null; } catch { return null; }
}

/** Unlocks speech on mobile; call from a tap before speaking later. */
export const primeSpeech = () => createSpeech().prime?.();
