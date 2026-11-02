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
  addListener?(eventName: 'onRangeStart', listener: (event: { start: number; end: number; spokenWord: string }) => void): Promise<{ remove(): Promise<void> }>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class NativeTimeout extends Error {}
/** Rejects with a NativeTimeout if a native call never answers, so the reader can show a real reason instead of hanging. */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NativeTimeout(`${what} did not respond`)), ms);
  });
  return Promise.race([work, limit]).finally(() => { if (timer) clearTimeout(timer); });
}
const errorMessage = (error: unknown) => String((error as any)?.message ?? error ?? 'Speech failed');
const isMissingNativePlugin = (message: string) => /not implemented|plugin .*not found|not registered|unimplemented/i.test(message);
const isSpeechUnavailable = (message: string) => /not implemented|not registered|not installed|unavailable|not initiali|no speech|no .*engine|not ready|not connected|engine.*not available|engine.*unavailable|compatible speech voice|no compatible speech voice|language.*not.*(available|supported|installed)|missing.*(voice|data)/i.test(message);

/**
 * Native TTS is asynchronous twice over: Android's TTS engine initializes after
 * the Capacitor bridge is ready, and speak() resolves only after the utterance
 * finishes. Probe readiness with a bounded retry, serialize stop-before-speak,
 * and use onRangeStart where the platform exposes it so the reader can tell when
 * audio has actually begun. Android routes TTS to the currently selected system
 * output (speaker, wired headset or Bluetooth); the app must not force a route.
 */
export function createNativeSpeech(load: () => Promise<NativeTTS | null>, preferred: string[]): Speech {
  let languagePromise: Promise<string> | null = null;
  let generation = 0;
  let native: NativeTTS | null = null;
  let pendingStop: Promise<void> = Promise.resolve();
  let rangeListenerPromise: Promise<void> | null = null;
  let onCurrentSpeechStart: (() => void) | null = null;
  let startFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const chooseLanguage = async (tts: NativeTTS): Promise<string> => {
    let lastError = '';
    const canonical = (value: string) => value.toLowerCase().replace(/_/g, '-');

    // TextToSpeech is created asynchronously by Android. A first language query
    // can legitimately be empty while its service is still initializing.
    for (let attempt = 0; attempt < 9; attempt++) {
      let available: string[] = [];
      try {
        available = (await tts.getSupportedLanguages?.())?.languages ?? [];
      } catch (error) {
        lastError = errorMessage(error);
        if (isMissingNativePlugin(lastError)) throw new Error('Native text-to-speech is not installed in this app build. Rebuild after syncing Capacitor plugins.');
      }

      for (const candidate of preferred) {
        const match = available.find((value) => canonical(value) === canonical(candidate))
          ?? available.find((value) => canonical(value).split('-')[0] === canonical(candidate).split('-')[0]);
        if (match) return match;

        try {
          if ((await tts.isLanguageSupported({ lang: candidate })).supported) return candidate;
        } catch (error) {
          lastError = errorMessage(error);
          if (isMissingNativePlugin(lastError)) throw new Error('Native text-to-speech is not installed in this app build. Rebuild after syncing Capacitor plugins.');
        }
      }

      if (available.length) break; // The engine is ready; none of the requested languages is installed.
      if (attempt < 8) await wait(Math.min(1500, 300 + attempt * 175));
    }

    if (lastError) throw new Error(lastError);
    throw new Error('No compatible speech voice is installed for your device language. Install a voice for that language in your device speech settings, then retry.');
  };

  const pickLanguage = (tts: NativeTTS): Promise<string> => {
    if (!languagePromise) {
      languagePromise = chooseLanguage(tts).catch((error) => {
        // Do not cache failures: a voice may be installed while the app is open.
        languagePromise = null;
        throw error;
      });
    }
    return languagePromise;
  };

  const ensureRangeListener = (tts: NativeTTS): Promise<void> => {
    if (!tts.addListener) return Promise.resolve();
    if (!rangeListenerPromise) {
      rangeListenerPromise = tts.addListener('onRangeStart', () => {
        onCurrentSpeechStart?.();
      }).then(() => undefined).catch(() => undefined);
    }
    return rangeListenerPromise;
  };

  return {
    // Android speech services can take several seconds to initialise on a cold start.
    // Keep the engine's watchdog longer than the bounded plugin/language/listener checks below.
    startTimeoutMs: 20000,
    speak(text, { rate }, h) {
      const request = ++generation;
      void (async () => {
        const tts = await withTimeout(load(), 3000, 'Speech plugin');
        if (request !== generation) return;
        if (!tts) {
          h.onerror('unsupported');
          return;
        }
        native = tts;

        // If pause/next called stop(), do not let its asynchronous native stop
        // race with this new utterance and silence it. A stop that never answers
        // must not block speech forever.
        await withTimeout(pendingStop.catch(() => undefined), 1000, 'Speech stop').catch(() => undefined);
        if (request !== generation) return;

        let lang: string;
        try {
          lang = await withTimeout(pickLanguage(tts), 10500, 'Speech language check');
        } catch (error) {
          // A slow or stuck language probe is not proof that speaking will fail. Try the phone's own
          // language and let speak() report a real error if that is wrong. Real "no voice" errors still surface.
          if (!(error instanceof NativeTimeout)) throw error;
          languagePromise = null;
          lang = preferred[0] || 'en-US';
        }
        if (request !== generation) return;
        await withTimeout(ensureRangeListener(tts), 1000, 'Speech listener').catch(() => undefined);
        if (request !== generation) return;

        let started = false;
        if (startFallbackTimer) clearTimeout(startFallbackTimer);
        const markStarted = () => {
          if (request !== generation || started) return;
          started = true;
          if (startFallbackTimer) clearTimeout(startFallbackTimer);
          startFallbackTimer = null;
          onCurrentSpeechStart = null;
          h.onstart();
        };
        onCurrentSpeechStart = markStarted;

        // Some Android vendors / older TTS engines expose the listener but do
        // not emit range callbacks. Keep a bounded fallback so those devices
        // still work; an actual native rejection is always surfaced below.
        startFallbackTimer = setTimeout(markStarted, 2200);

        try {
          const speaking = tts.speak({
            text,
            lang,
            rate: Math.min(2, Math.max(0.1, rate)),
            pitch: 1,
            volume: 1,
            queueStrategy: 0,
            category: 'playback', // Used by iOS; Android follows the system's selected audio route.
          });
          await speaking;
          if (request !== generation) return;
          if (startFallbackTimer) clearTimeout(startFallbackTimer);
          startFallbackTimer = null;
          markStarted(); // Covers very short utterances or services without range callbacks.
          onCurrentSpeechStart = null;
          h.onend();
        } catch (error) {
          if (request !== generation) return;
          if (startFallbackTimer) clearTimeout(startFallbackTimer);
          startFallbackTimer = null;
          onCurrentSpeechStart = null;
          const message = errorMessage(error);
          h.onerror(isSpeechUnavailable(message) ? 'unsupported' : message || 'speech-failed');
        }
      })().catch((error) => {
        if (request !== generation) return;
        onCurrentSpeechStart = null;
        const message = errorMessage(error);
        h.onerror(isSpeechUnavailable(message) ? 'unsupported' : message);
      });
    },
    cancel() {
      generation++;
      onCurrentSpeechStart = null;
      if (startFallbackTimer) clearTimeout(startFallbackTimer);
      startFallbackTimer = null;
      const tts = native;
      if (!tts) return;
      // Queue native stop operations and make the next speak() await this promise.
      pendingStop = pendingStop.catch(() => undefined).then(() => tts.stop()).catch(() => undefined);
      void pendingStop.catch(() => undefined);
    },
    prime() {
      // Native TTS has no browser-style autoplay gate. Start loading and probing the
      // Android speech service on a user gesture so its cold-start delay happens before
      // the first phrase (often while the student is choosing or preparing a page).
      void load().then(async (tts) => {
        if (!tts) return;
        native = tts;
        try { await withTimeout(pickLanguage(tts), 10500, 'Speech engine warm-up'); }
        catch { /* the real playback attempt retries and reports the useful error */ }
      }).catch(() => undefined);
    },
  };
}

/**
 * Capacitor plugins are Proxy objects that answer EVERY property name, including `then`.
 * Returning one straight out of a promise makes JavaScript treat it as a thenable and wait
 * for a `then` call that never completes, so the load never finishes and no speech ever
 * starts. Wrapping the plugin in a plain object avoids that.
 */
const plainTTS = (plugin: any): NativeTTS => ({
  speak: (o) => plugin.speak(o),
  stop: () => plugin.stop(),
  isLanguageSupported: (o) => plugin.isLanguageSupported(o),
  getSupportedLanguages: () => plugin.getSupportedLanguages(),
  openInstall: () => plugin.openInstall(),
  addListener: (eventName, listener) => plugin.addListener(eventName, listener),
});

const loadNativeTTS = (() => {
  let p: Promise<NativeTTS | null> | null = null;
  return () => (p ??= import('@capacitor-community/text-to-speech').then((m) => plainTTS(m.TextToSpeech)).catch(() => { p = null; return null; }));
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
// The reader, voice assistant and warm-up action must share the same native
// controller. Besides serialising utterances, this shares the Android TTS
// readiness probe, so a warm-up is not wasted on a separate controller.
let nativeSpeechController: Speech | null = null;
export function createSpeech(): Speech {
  if (!isNative()) return createWebSpeech();
  if (!nativeSpeechController) {
    const nav = deviceLang();
    nativeSpeechController = createNativeSpeech(loadNativeTTS, [...new Set([nav, nav.split('-')[0], 'en-US'])]);
  }
  return nativeSpeechController;
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
  // Native TTS is rendered by Android/iOS and follows the operating system's
  // audio route. Do not run a silent WebView audio stream alongside it: that
  // can compete for audio focus and is unnecessary for native background speech.
  if (isNative()) return;
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
      .then(({ registerPlugin }) => {
        const plugin = registerPlugin<NativeMediaPlugin>('ExamMateMedia');
        // A plain wrapper: returning the plugin Proxy itself from a promise never resolves (see plainTTS).
        const plain: NativeMediaPlugin = {
          activate: () => plugin.activate(),
          update: (o) => plugin.update(o),
          deactivate: () => plugin.deactivate(),
          getAudioRoutes: () => plugin.getAudioRoutes(),
          addListener: (eventName, listener) => plugin.addListener(eventName, listener),
        };
        return plain;
      })
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
