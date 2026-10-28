import type { Clock } from '../engine';
import type { Recognizer } from './recognizer';
import { matchWake, parseCommand, type Command } from './wake';

/** What the assistant needs to control while it listens. */
export interface ReaderControl {
  /** Playing or counting down (as opposed to paused, finished or stopped). */
  isPlaying(): boolean;
  pause(): void;
  resume(): void;
  repeat(): void;
  next(): void;
  back(): void;
  stop(): void;
  slower(): void;
  faster(): void;
}

export interface AskContext { context: string; current: string }

/** The AI's decision: do something to the reader (`action`), or just answer (`action: 'none'`). */
export interface AskResult {
  action: Command | 'none';
  answer: string;
  /** How long the server took, in milliseconds (shown to the owner). */
  ms?: number;
}

/** Thrown by the ask function. `license` means access was revoked; `key` means the Gemini key needs attention. */
export class AskFailure extends Error {
  constructor(message: string, public readonly kind: 'license' | 'key' | 'other' = 'other') {
    super(message);
  }
}

export interface AssistantDeps {
  recognizer: Recognizer | null;
  reader: ReaderControl;
  clock: Clock;
  speak(text: string): Promise<void>;
  cancelSpeech(): void;
  /** The AI works out what the person wants, however they word it. */
  ask(question: string, ctx: AskContext): Promise<AskResult>;
  /** Wakes the server up while the person is still speaking, so the answer comes back sooner. */
  warm?(): void;
  context(): AskContext;
  tones: { ding(): void; dong(): void; error(): void };
  haptics?: { start(): void; thinking(): void; finish(): void; error(): void };
  onAnswered?(question: string, answer: string): void;
  onLicenseLost?(): void;
}

export interface AssistantOptions {
  wakePhrase: string;
  /** Give up if nothing is said within this long after the trigger. */
  noSpeechMs: number;
  /** A question is finished after this much silence. */
  silenceMs: number;
  /** Hard limit for one question. */
  maxMs: number;
  /** The whole AI round trip must finish within this. */
  askTimeoutMs: number;
  /** Show "Still thinking…" after this long. */
  slowMs: number;
  /** Longest to wait for a listening session to close before opening the next. */
  stopWaitMs: number;
  /** If the microphone never reports it is open, ding anyway after this long. */
  readyDingMs: number;
}

export const DEFAULT_OPTIONS: AssistantOptions = {
  wakePhrase: 'hey exam mate', noSpeechMs: 6000, silenceMs: 1500, maxMs: 12000,
  askTimeoutMs: 18000, slowMs: 5000, stopWaitMs: 900, readyDingMs: 900,
};

/** off: switched off. idle: ready (hold button works) but not listening for the wake phrase. waiting: listening for it. */
export type AssistantStatus = 'off' | 'idle' | 'waiting' | 'listening' | 'thinking' | 'speaking';
export type TriggerSource = 'wake' | 'hold' | 'earbud';

export interface AssistantSnapshot {
  status: AssistantStatus;
  enabled: boolean;
  transcript: string;
  answer: string;
  message: string;
  /** True once the AI has taken longer than expected. */
  slow: boolean;
  /** Server time for the last answer, in ms (0 if unknown). */
  ms: number;
}

const OFF: AssistantSnapshot = { status: 'off', enabled: false, transcript: '', answer: '', message: '', slow: false, ms: 0 };

interface LiveSession { sess: number; onText(text: string, final: boolean): void; onEnd(): void }

/**
 * Siri-style helper for the reader. When it hears the wake phrase (or is triggered by the hold button):
 * pause the reader, listen to what you say, let the AI work out whether you want the reader controlled or a
 * question answered, do it, and carry on reading where it left off.
 * Framework-free so the whole flow can be tested with fakes.
 */
export class VoiceAssistant {
  private snap: AssistantSnapshot = OFF;
  private listeners = new Set<() => void>();
  private gen = 0; // bumped whenever the current flow is abandoned; every async step checks it
  private wakeSess = 0;
  private live: LiveSession | null = null; // the wake-listening session, reused to hear the question (no restart, no lost words)
  private timers = new Set<unknown>();
  private restartDelay = 300;
  private wake = false;
  private abortCapture: (() => void) | null = null;
  private resumeOnCancel = false;

  constructor(private deps: AssistantDeps, private opts: AssistantOptions = DEFAULT_OPTIONS) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = () => this.snap;
  setOptions(p: Partial<AssistantOptions>) { this.opts = { ...this.opts, ...p }; }

  private set(p: Partial<AssistantSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }
  private later(fn: () => void, ms: number) {
    const id = this.deps.clock.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }
  private cancelLater(id: unknown) {
    this.deps.clock.clearTimeout(id);
    this.timers.delete(id);
  }
  private clearTimers() {
    this.timers.forEach((t) => this.deps.clock.clearTimeout(t));
    this.timers.clear();
  }

  /** Closes the listening session and waits (briefly) until it has really ended, so the next one never overlaps it. */
  private async stopRecognizer() {
    const rec = this.deps.recognizer;
    if (!rec) return;
    let t: unknown;
    await Promise.race([
      rec.stop().catch(() => undefined),
      new Promise<void>((r) => { t = this.deps.clock.setTimeout(r, this.opts.stopWaitMs); }),
    ]);
    this.deps.clock.clearTimeout(t);
  }

  /** Switch on. `wake` = also listen for the wake phrase (otherwise only the hold button / earbud trigger work). */
  async enable(o: { wake: boolean }) {
    if (!this.deps.recognizer) {
      this.set({ message: 'Voice is not supported on this device.' });
      return;
    }
    const wasBusy = ['listening', 'thinking', 'speaking'].includes(this.snap.status);
    if (this.snap.enabled && this.wake === o.wake) return;
    this.wake = o.wake;
    if (wasBusy) { this.set({ enabled: true }); return; } // finish the current question first; it re-reads this.wake afterwards
    this.gen++;
    this.live = null;
    this.clearTimers();
    await this.stopRecognizer();
    this.set({ enabled: true, status: o.wake ? 'waiting' : 'idle', message: '' });
    this.deps.warm?.();
    if (o.wake) this.listenForWake();
  }

  /** Switch off and abandon whatever is happening. Does not touch the reader. */
  async disable() {
    if (!this.snap.enabled && this.snap.status === 'off') return;
    this.gen++;
    this.live = null;
    this.clearTimers();
    this.abortCapture?.();
    this.deps.cancelSpeech();
    await this.stopRecognizer();
    this.set({ ...OFF, message: this.snap.message });
  }

  /** The user cancelled mid-question: stop, and carry on reading if we had paused it. */
  async cancel() {
    if (!['listening', 'thinking', 'speaking'].includes(this.snap.status)) return;
    const resume = this.resumeOnCancel;
    this.gen++;
    this.live = null;
    this.clearTimers();
    this.abortCapture?.();
    this.deps.cancelSpeech();
    await this.stopRecognizer();
    this.resumeOnCancel = false;
    if (resume) this.deps.reader.resume();
    this.backToReady('');
  }

  private backToReady(message: string) {
    this.restartDelay = 300;
    this.set({ status: this.wake ? 'waiting' : 'idle', message, slow: false });
    if (this.wake) this.listenForWake();
    const g = this.gen;
    this.later(() => {
      if (g === this.gen && (this.snap.status === 'waiting' || this.snap.status === 'idle')) this.set({ transcript: '', answer: '', message: '', ms: 0 });
    }, 5000);
  }

  /* ---------------- listening for the wake phrase ---------------- */
  private listenForWake() {
    const rec = this.deps.recognizer;
    if (!rec) return;
    const g = this.gen;
    const sess = ++this.wakeSess;
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      if (g !== this.gen || this.snap.status !== 'waiting') return;
      if (reason === 'denied' || reason === 'unavailable') {
        this.set({ enabled: false, status: 'off', message: reason === 'denied' ? 'Microphone access was denied. Allow it in your phone settings.' : 'Voice recognition is not available right now.' });
        return;
      }
      if (reason === 'error') this.restartDelay = Math.min(this.restartDelay * 2, 8000);
      else this.restartDelay = 300;
      this.later(() => { if (g === this.gen && this.snap.status === 'waiting') this.listenForWake(); }, this.restartDelay);
    };
    rec.start({
      onText: (text, final) => {
        // once the wake phrase is heard, this very session carries on listening for the question
        if (this.live && this.live.sess === sess) { this.live.onText(text, final); return; }
        if (g !== this.gen || this.snap.status !== 'waiting') return;
        const m = matchWake(text, this.opts.wakePhrase);
        if (m.matched) void this.trigger('wake', m.rest, sess);
      },
      onEnd: (reason) => {
        if (this.live && this.live.sess === sess) { this.live.onEnd(); return; }
        end(reason);
      },
    }).catch(() => end('error'));
  }

  /* ---------------- one request, start to finish ---------------- */
  async trigger(source: TriggerSource, seed = '', liveSess?: number) {
    if (!this.snap.enabled) return;
    if (this.snap.status !== 'waiting' && this.snap.status !== 'idle') return; // already busy
    const g = ++this.gen;
    this.clearTimers();
    this.deps.warm?.(); // wake the server up now, while the person is still speaking
    void source;

    if (liveSess === undefined) {
      await this.stopRecognizer();
      if (g !== this.gen) return;
    }

    const wasPlaying = this.deps.reader.isPlaying();
    this.resumeOnCancel = wasPlaying;
    if (wasPlaying) this.deps.reader.pause();
    this.deps.cancelSpeech();
    this.set({ status: 'listening', transcript: '', answer: '', message: '', slow: false, ms: 0 });

    const question = await this.capture(g, liveSess !== undefined ? { sess: liveSess, seed } : undefined);
    if (g !== this.gen) return;

    if (!question) {
      this.deps.tones.error();
      this.deps.haptics?.error();
      this.set({ status: 'speaking', message: "I didn't catch that." });
      await this.deps.speak("Sorry, I didn't catch that.").catch(() => undefined);
      return this.finish(g, wasPlaying, "I didn't catch that.");
    }
    this.set({ transcript: question, status: 'thinking' });
    this.deps.haptics?.thinking();
    const slowTimer = this.later(() => {
      if (g === this.gen && this.snap.status === 'thinking') this.set({ slow: true });
    }, this.opts.slowMs);

    let result: AskResult | null = null;
    let failure: AskFailure | null = null;
    try {
      result = await this.withTimeout(this.deps.ask(question, this.deps.context()));
    } catch (e) {
      failure = e instanceof AskFailure ? e : new AskFailure("Sorry, I couldn't get an answer.");
    }
    this.cancelLater(slowTimer);
    if (g !== this.gen) return;

    if (failure?.kind === 'license') {
      this.deps.onLicenseLost?.();
      return;
    }

    if (!result) {
      // The AI could not be reached. Plain commands still work, so the reader is never left stuck.
      const cmd = parseCommand(question);
      if (cmd) {
        this.runCommand(cmd, wasPlaying);
        return this.finish(g, false, '');
      }
      const msg = failure!.message;
      this.deps.haptics?.error();
      this.deps.tones.error();
      this.set({ status: 'speaking', answer: msg, slow: false });
      await this.deps.speak(msg).catch(() => undefined);
      return this.finish(g, wasPlaying, msg);
    }

    if (result.action !== 'none') {
      // The AI understood this as an instruction to the reader: just do it.
      this.deps.haptics?.finish();
      this.runCommand(result.action, wasPlaying);
      this.set({ answer: result.answer, ms: result.ms ?? 0, slow: false });
      return this.finish(g, false, result.answer);
    }

    this.set({ status: 'speaking', answer: result.answer, ms: result.ms ?? 0, slow: false });
    await this.deps.speak(result.answer).catch(() => undefined);
    if (g !== this.gen) return;
    this.deps.haptics?.finish();
    this.deps.onAnswered?.(question, result.answer);
    return this.finish(g, wasPlaying, '');
  }

  private finish(g: number, resumeReader: boolean, message: string) {
    if (g !== this.gen) return;
    this.deps.tones.dong();
    this.resumeOnCancel = false;
    if (resumeReader) this.deps.reader.resume(); // re-reads the phrase that was interrupted
    this.backToReady(message);
  }

  private runCommand(cmd: Command, wasPlaying: boolean) {
    const r = this.deps.reader;
    switch (cmd) {
      case 'repeat': r.repeat(); break;
      case 'next': r.next(); break;
      case 'back': r.back(); break;
      case 'pause': break; // already paused by the trigger
      case 'resume': r.resume(); break;
      case 'stop': r.stop(); break;
      case 'slower': r.slower(); if (wasPlaying) r.resume(); break;
      case 'faster': r.faster(); if (wasPlaying) r.resume(); break;
    }
  }

  /**
   * Listens until the person stops talking and resolves with what was said ('' if nothing).
   * After the wake phrase it keeps using the same listening session, so nothing is lost while restarting.
   */
  private capture(g: number, live?: { sess: number; seed: string }): Promise<string> {
    return new Promise((resolve) => {
      const rec = this.deps.recognizer;
      if (!rec) return resolve('');
      let last = live?.seed.trim() ?? '';
      let heard = last.length > 0;
      let done = false;
      let dinged = false;
      let silence: unknown = null;
      let ready: unknown = null;

      const ding = () => {
        if (dinged) return;
        dinged = true;
        this.deps.tones.ding();
        this.deps.haptics?.start();
      };
      const finish = () => {
        if (done) return;
        done = true;
        this.abortCapture = null;
        this.live = null;
        this.deps.clock.clearTimeout(silence);
        this.cancelLater(ready);
        this.cancelLater(none);
        this.cancelLater(max);
        void rec.stop().catch(() => undefined);
        resolve(last.trim());
      };
      const none = this.later(() => { if (!heard) finish(); }, this.opts.noSpeechMs);
      const max = this.later(finish, this.opts.maxMs);
      this.abortCapture = () => { last = ''; finish(); };

      const bump = (final: boolean) => {
        this.deps.clock.clearTimeout(silence);
        silence = this.deps.clock.setTimeout(finish, final ? 600 : this.opts.silenceMs);
      };
      const onText = (text: string, final: boolean) => {
        if (done || g !== this.gen) return;
        const m = matchWake(text, this.opts.wakePhrase);
        const q = (m.matched ? m.rest : text).trim();
        if (!q) return; // still only the wake phrase
        last = q;
        heard = true;
        this.set({ transcript: q });
        bump(final);
      };
      const startFresh = () => {
        this.live = null;
        ready = this.later(ding, this.opts.readyDingMs); // if the engine never says "ready", ding anyway
        rec.start({
          onReady: () => { this.cancelLater(ready); ding(); },
          onText,
          onEnd: () => finish(),
        }).catch(() => finish());
      };

      if (live) {
        ding(); // the microphone is already open: "go ahead"
        this.live = { sess: live.sess, onText, onEnd: () => { if (done) return; if (heard) finish(); else startFresh(); } };
        if (heard) { this.set({ transcript: last }); bump(false); }
      } else {
        startFresh();
      }
    });
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = this.deps.clock.setTimeout(() => reject(new AskFailure('Sorry, that took too long. Try again.')), this.opts.askTimeoutMs);
      p.then((v) => { this.deps.clock.clearTimeout(t); resolve(v); }, (e) => { this.deps.clock.clearTimeout(t); reject(e); });
    });
  }
}
