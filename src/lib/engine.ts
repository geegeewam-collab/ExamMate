import { splitText, speakCodeLine, speakPunctuation, speakSymbols, wordCount, type PhraseMode } from './text';

export interface SpeakHandlers {
  onstart(): void;
  onend(): void;
  onerror(error: string): void;
}

export interface Speech {
  speak(text: string, opts: { rate: number; voiceURI: string }, h: SpeakHandlers): void;
  cancel(): void;
  /** Unlocks speech on mobile browsers; call from a user gesture. */
  prime?(): void;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): number;
}

export const realClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface EngineOptions {
  rate: number;
  gapS: number;
  pw: number;
  mode: PhraseMode;
  twice: boolean;
  punct: boolean;
  advance: 'timer' | 'tap';
  lead: number;
  voice: string;
}

export type EngineState = 'idle' | 'counting' | 'playing' | 'paused';
/** What the person should be doing right now. */
export type Phase = 'listen' | 'write' | 'tap' | 'count' | 'done';

export interface Snapshot {
  /** A reading session exists (from Start until Stop). */
  active: boolean;
  state: EngineState;
  phase: Phase;
  finished: boolean;
  phrases: readonly string[];
  lines: readonly string[];
  lineOf: readonly number[];
  codeOf: readonly boolean[];
  codeLineNumber: readonly number[];
  offsetOf: readonly number[];
  idx: number;
  /** Seconds left in the optional start countdown. */
  countdown: number;
  /** Length of the current writing gap and when it ends (ms since epoch). */
  gapMs: number;
  gapEndsAt: number;
  /** Changes for every gap so the UI can restart its progress animation. */
  gapKey: number;
  hint: string;
}

export const NO_VOICE = 'No compatible speech voice is available. On Android, open Settings > Text-to-speech output and install a voice for your language. On iPhone, check Settings > Accessibility > Spoken Content and download a voice. Return to Exam Mate and press Resume.';

const EMPTY: Snapshot = {
  active: false,
  state: 'idle',
  phase: 'listen',
  finished: false,
  phrases: [],
  lines: [],
  lineOf: [],
  codeOf: [],
  codeLineNumber: [],
  offsetOf: [],
  idx: 0,
  countdown: 0,
  gapMs: 0,
  gapEndsAt: 0,
  gapKey: 0,
  hint: '',
};

/**
 * Reads phrases aloud with a writing gap after each one.
 * Plain TypeScript with no React or browser dependencies, so it can be tested directly.
 * Every callback checks `session` so stale speech or timer events are ignored.
 */
export class ReaderEngine {
  private snap: Snapshot = EMPTY;
  private listeners = new Set<() => void>();
  private session = 0;
  private timer: unknown = null;
  private hintTimer: unknown = null;
  private waiting: (() => void) | null = null;
  private spoke = false;
  private sourceText = '';

  constructor(
    private speech: Speech,
    private clock: Clock,
    private opts: EngineOptions,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;

  setOptions(p: Partial<EngineOptions>) {
    const previousMode = this.opts.mode;
    this.opts = { ...this.opts, ...p };
    if (!p.mode || p.mode === previousMode || !this.snap.active || this.snap.finished || !this.sourceText) return;

    // Re-segment the open paper when the student changes pace, keeping the current
    // source position rather than silently applying the new phrase size only next time.
    const currentOffset = this.snap.offsetOf[this.snap.idx] ?? 0;
    const wasPlaying = this.snap.state === 'playing';
    const split = splitText(this.sourceText, this.opts.mode);
    if (!split.phrases.length) return;
    let nextIndex = 0;
    for (let i = 0; i < split.offsetOf.length; i++) {
      if (split.offsetOf[i] > currentOffset) break;
      nextIndex = i;
    }

    this.halt();
    this.set({
      phrases: split.phrases, lineOf: split.lineOf, lines: split.lines,
      codeOf: split.codeOf, codeLineNumber: split.codeLineNumber, offsetOf: split.offsetOf,
      idx: nextIndex, state: 'paused', phase: 'listen', countdown: 0, gapMs: 0, gapEndsAt: 0,
    });
    if (wasPlaying) this.run(nextIndex);
  }

  private set(p: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }

  /** Stops speech and invalidates every pending callback. */
  private halt() {
    this.session++;
    this.clock.clearTimeout(this.timer);
    this.clock.clearTimeout(this.hintTimer);
    this.timer = this.hintTimer = null;
    this.waiting = null;
    this.speech.cancel();
  }

  /** Begin reading `text`, optionally from phrase `from`. Returns false if there is nothing to read. */
  start(text: string, from = 0): boolean {
    const t = text.trim();
    if (!t) return false;
    this.sourceText = t;
    const { phrases, lineOf, lines, codeOf, codeLineNumber, offsetOf } = splitText(t, this.opts.mode);
    if (!phrases.length) return false;
    this.halt();
    const first = Math.min(Math.max(0, from), phrases.length - 1);
    this.spoke = false;
    this.snap = { ...EMPTY, active: true, phrases, lineOf, lines, codeOf, codeLineNumber, offsetOf, idx: first };

    const lead = this.opts.lead;
    if (lead > 0) {
      this.speech.prime?.();
      const my = ++this.session;
      let c = lead;
      const tick = () => {
        if (my !== this.session) return;
        if (c <= 0) {
          this.run(first);
          return;
        }
        this.set({ state: 'counting', phase: 'count', countdown: c });
        c--;
        this.timer = this.clock.setTimeout(tick, 1000);
      };
      tick();
    } else {
      this.run(first);
    }
    return true;
  }

  private run(i: number, pass = 1) {
    this.waiting = null;
    this.clock.clearTimeout(this.timer);
    if (i < 0) i = 0;
    if (i >= this.snap.phrases.length) {
      this.finish();
      return;
    }
    const my = ++this.session;
    this.speech.cancel();
    this.set({ idx: i, state: 'playing', phase: 'listen', countdown: 0, gapMs: 0, gapEndsAt: 0 });

    const phrase = this.snap.phrases[i];
    const isCode = this.snap.codeOf[i] === true;
    const spoken = isCode ? speakCodeLine(phrase, this.snap.codeLineNumber[i] || 1) : speakSymbols(phrase);
    const text = this.opts.punct && !isCode ? speakPunctuation(spoken) : spoken;

    if (!this.spoke && this.hintTimer == null) {
      this.hintTimer = this.clock.setTimeout(() => {
        this.hintTimer = null;
        if (!this.spoke && this.snap.state === 'playing') this.set({ hint: 'No sound? Tap Pause, then Resume.' });
      }, 3500);
    }

    this.speech.speak(text, { rate: this.opts.rate, voiceURI: this.opts.voice }, {
      onstart: () => {
        if (my !== this.session) return;
        this.spoke = true;
        if (this.snap.hint) this.set({ hint: '' });
      },
      onend: () => {
        if (my !== this.session || this.snap.state !== 'playing') return;
        const twice = this.opts.twice;
        const again = twice && pass === 1;
        let gap = this.opts.gapS + wordCount(phrase) * this.opts.pw;
        if (twice && pass === 2) gap = Math.max(1, gap / 2);
        const go = () => this.run(again ? i : i + 1, again ? 2 : 1);

        if (this.opts.advance === 'tap') {
          this.waiting = go;
          this.set({ phase: 'tap' });
          return;
        }
        const ms = Math.max(0, gap) * 1000;
        this.set({ phase: 'write', gapMs: ms, gapEndsAt: this.clock.now() + ms, gapKey: this.snap.gapKey + 1 });
        this.timer = this.clock.setTimeout(go, ms);
      },
      onerror: (e) => {
        if (my !== this.session || e === 'interrupted' || e === 'canceled') return;
        if (e === 'unsupported') {
          this.halt();
          this.set({ state: 'paused', phase: 'listen', gapMs: 0, gapEndsAt: 0, hint: NO_VOICE });
          return;
        }
        this.timer = this.clock.setTimeout(() => {
          if (my === this.session) this.run(i + 1);
        }, 400);
      },
    });
  }

  private finish() {
    this.halt();
    this.set({ state: 'idle', phase: 'done', finished: true, gapMs: 0, gapEndsAt: 0, hint: '' });
  }

  pause() {
    if (!this.snap.active || this.snap.finished || this.snap.state === 'idle' || this.snap.state === 'paused') return;
    this.halt();
    this.set({ state: 'paused', phase: 'listen', countdown: 0, gapMs: 0, gapEndsAt: 0 });
  }
  resume() {
    if (this.snap.state === 'paused') this.run(this.snap.idx);
  }
  /** Pause / resume, or read again once finished. */
  toggle() {
    const s = this.snap.state;
    if (s === 'playing') this.pause();
    else if (s === 'paused') this.resume();
    else if (s === 'idle' && this.snap.active && this.snap.phrases.length) {
      this.set({ finished: false });
      this.run(0);
    }
  }
  next() {
    if (this.canMove()) this.run(this.snap.idx + 1);
  }
  back() {
    if (this.canMove()) this.run(this.snap.idx - 1);
  }
  repeat() {
    if (this.canMove()) this.run(this.snap.idx);
  }
  jump(i: number) {
    if (this.canMove()) this.run(i);
  }
  /** Jump to the first phrase of text line `li` (a question). */
  jumpToLine(li: number) {
    const i = this.snap.lineOf.indexOf(li);
    if (i >= 0) this.jump(i);
  }
  /** In "wait until I tap" mode: carry on to the next phrase. */
  tap() {
    const f = this.waiting;
    if (f) {
      this.waiting = null;
      f();
    }
  }
  private canMove() {
    return this.snap.active && this.snap.state !== 'counting' && this.snap.phrases.length > 0;
  }

  stop() {
    this.halt();
    this.snap = EMPTY;
    this.sourceText = '';
    this.listeners.forEach((l) => l());
  }
  /** For component unmount: silence everything but keep subscribers (React StrictMode remounts). */
  destroy() {
    this.halt();
  }
}
