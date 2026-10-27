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
  ask(question: string, ctx: AskContext): Promise<string>;
  context(): AskContext;
  tones: { ding(): void; dong(): void; error(): void };
  haptics?: { start(): void; thinking(): void; finish(): void; error(): void };
  onAnswered?(question: string, answer: string): void;
  onLicenseLost?(): void;
}

export interface AssistantOptions {
  wakePhrase: string;
  /** Give up if nothing is said within this long after the wake trigger. */
  noSpeechMs: number;
  /** A question is finished after this much silence. */
  silenceMs: number;
  /** Hard limit for one question. */
  maxMs: number;
  askTimeoutMs: number;
}

export const DEFAULT_OPTIONS: AssistantOptions = { wakePhrase: 'hey exam mate', noSpeechMs: 6000, silenceMs: 1500, maxMs: 12000, askTimeoutMs: 25000 };

/** off: switched off. idle: ready (hold button works) but not listening for the wake phrase. waiting: listening for it. */
export type AssistantStatus = 'off' | 'idle' | 'waiting' | 'listening' | 'thinking' | 'speaking';
export type TriggerSource = 'wake' | 'hold' | 'earbud';

export interface AssistantSnapshot {
  status: AssistantStatus;
  enabled: boolean;
  transcript: string;
  answer: string;
  message: string;
}

const OFF: AssistantSnapshot = { status: 'off', enabled: false, transcript: '', answer: '', message: '' };

/**
 * Siri-style helper for the reader. When it hears the wake phrase (or is triggered by the hold button):
 * ding, pause the reader, listen to the question, then either run a command ("next", "repeat"...) or ask the AI,
 * speak the answer, and carry on reading where it left off.
 * Framework-free so the whole flow can be tested with fakes.
 */
export class VoiceAssistant {
  private snap: AssistantSnapshot = OFF;
  private listeners = new Set<() => void>();
  private gen = 0; // bumped whenever the current flow is abandoned; every async step checks it
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
  private clearTimers() {
    this.timers.forEach((t) => this.deps.clock.clearTimeout(t));
    this.timers.clear();
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
    this.clearTimers();
    try { await this.deps.recognizer.stop(); } catch { /* ignore */ }
    this.set({ enabled: true, status: o.wake ? 'waiting' : 'idle', message: '' });
    if (o.wake) this.listenForWake();
  }

  /** Switch off and abandon whatever is happening. Does not touch the reader. */
  async disable() {
    if (!this.snap.enabled && this.snap.status === 'off') return;
    this.gen++;
    this.clearTimers();
    this.abortCapture?.();
    this.deps.cancelSpeech();
    try { await this.deps.recognizer?.stop(); } catch { /* ignore */ }
    this.set({ ...OFF, message: this.snap.message });
  }

  /** The user cancelled mid-question: stop, and carry on reading if we had paused it. */
  async cancel() {
    if (!['listening', 'thinking', 'speaking'].includes(this.snap.status)) return;
    const resume = this.resumeOnCancel;
    this.gen++;
    this.clearTimers();
    this.abortCapture?.();
    this.deps.cancelSpeech();
    try { await this.deps.recognizer?.stop(); } catch { /* ignore */ }
    this.resumeOnCancel = false;
    if (resume) this.deps.reader.resume();
    this.backToReady('');
  }

  private backToReady(message: string) {
    this.restartDelay = 300;
    this.set({ status: this.wake ? 'waiting' : 'idle', message });
    if (this.wake) this.listenForWake();
    const g = this.gen;
    this.later(() => { if (g === this.gen && (this.snap.status === 'waiting' || this.snap.status === 'idle')) this.set({ transcript: '', answer: '', message: '' }); }, 5000);
  }

  /* ---------------- listening for the wake phrase ---------------- */
  private listenForWake() {
    const rec = this.deps.recognizer;
    if (!rec) return;
    const g = this.gen;
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
      onText: (text) => {
        if (g !== this.gen || this.snap.status !== 'waiting') return;
        const m = matchWake(text, this.opts.wakePhrase);
        if (m.matched) void this.trigger('wake', m.rest);
      },
      onEnd: (reason) => end(reason),
    }).catch(() => end('error'));
  }

  /* ---------------- one question, start to finish ---------------- */
  async trigger(source: TriggerSource, spoken = '') {
    if (!this.snap.enabled) return;
    if (this.snap.status !== 'waiting' && this.snap.status !== 'idle') return; // already busy
    const g = ++this.gen;
    this.clearTimers();
    try { await this.deps.recognizer?.stop(); } catch { /* ignore */ }
    if (g !== this.gen) return;

    this.deps.tones.ding();
    this.deps.haptics?.start();
    const wasPlaying = this.deps.reader.isPlaying();
    this.resumeOnCancel = wasPlaying;
    if (wasPlaying) this.deps.reader.pause();
    this.deps.cancelSpeech();

    const inline = spoken.trim();
    const hasInline = inline.split(/\s+/).filter(Boolean).length >= 2; // "hey exam mate what is mitosis" in one breath
    this.set({ status: 'listening', transcript: hasInline ? inline : '', answer: '', message: '' });
    void source;

    const question = hasInline ? inline : await this.capture(g);
    if (g !== this.gen) return;

    if (!question) {
      this.deps.tones.error();
      return this.finish(g, wasPlaying, "I didn't hear anything.");
    }
    this.set({ transcript: question });

    const cmd = parseCommand(question);
    if (cmd) {
      this.runCommand(cmd, wasPlaying);
      return this.finish(g, false, '');
    }

    this.set({ status: 'thinking' });
    this.deps.haptics?.thinking();
    let answer: string;
    let ok = true;
    try {
      answer = await this.withTimeout(this.deps.ask(question, this.deps.context()));
    } catch (e) {
      if (g !== this.gen) return;
      if (e instanceof AskFailure && e.kind === 'license') {
        this.deps.onLicenseLost?.();
        return;
      }
      ok = false;
      this.deps.haptics?.error();
      this.deps.tones.error();
      answer = e instanceof AskFailure ? e.message : "Sorry, I couldn't get an answer.";
    }
    if (g !== this.gen) return;

    this.set({ status: 'speaking', answer });
    await this.deps.speak(answer).catch(() => undefined);
    if (g !== this.gen) return;
    if (ok) {
      this.deps.haptics?.finish();
      this.deps.onAnswered?.(question, answer);
    }
    return this.finish(g, wasPlaying, ok ? '' : answer);
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

  /** Listens until the person stops talking. Resolves with what was said ('' if nothing). */
  private capture(g: number): Promise<string> {
    return new Promise((resolve) => {
      const rec = this.deps.recognizer;
      if (!rec) return resolve('');
      let last = '';
      let heard = false;
      let done = false;
      let silence: unknown = null;
      const done_ = () => {
        if (done) return;
        done = true;
        this.abortCapture = null;
        this.deps.clock.clearTimeout(silence);
        this.deps.clock.clearTimeout(none);
        this.deps.clock.clearTimeout(max);
        void rec.stop().catch(() => undefined);
        resolve(last.trim());
      };
      const none = this.later(() => { if (!heard) done_(); }, this.opts.noSpeechMs);
      const max = this.later(done_, this.opts.maxMs);
      this.abortCapture = () => { last = ''; done_(); };
      rec.start({
        onText: (text, final) => {
          if (done || g !== this.gen) return;
          last = text;
          heard = true;
          this.set({ transcript: text });
          this.deps.clock.clearTimeout(silence);
          silence = this.deps.clock.setTimeout(done_, final ? 600 : this.opts.silenceMs);
        },
        onEnd: () => done_(),
      }).catch(() => done_());
    });
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = this.deps.clock.setTimeout(() => reject(new AskFailure("Sorry, that took too long. Try again.")), this.opts.askTimeoutMs);
      p.then((v) => { this.deps.clock.clearTimeout(t); resolve(v); }, (e) => { this.deps.clock.clearTimeout(t); reject(e); });
    });
  }
}
