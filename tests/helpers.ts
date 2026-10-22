import type { Clock, EngineOptions, Speech, SpeakHandlers } from '../src/lib/engine';

export class FakeClock implements Clock {
  t = 1_000_000;
  private q: { id: number; at: number; fn: () => void }[] = [];
  private n = 0;
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.n;
    this.q.push({ id, at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: unknown) {
    this.q = this.q.filter((x) => x.id !== id);
  }
  now() {
    return this.t;
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const nx = this.q[0];
      if (!nx || nx.at > end) break;
      this.q.shift();
      this.t = nx.at;
      nx.fn();
    }
    this.t = end;
  }
  get pending() {
    return this.q.length;
  }
}

export class FakeSpeech implements Speech {
  spoken: { text: string; rate: number; voiceURI: string }[] = [];
  cancels = 0;
  primed = 0;
  private cur: SpeakHandlers | null = null;
  autoStart = true;
  speak(text: string, o: { rate: number; voiceURI: string }, h: SpeakHandlers) {
    this.spoken.push({ text, ...o });
    this.cur = h;
    if (this.autoStart) h.onstart();
  }
  cancel() {
    this.cancels++;
  }
  prime() {
    this.primed++;
  }
  /** Simulate the voice finishing the current phrase. */
  finish() {
    this.cur?.onend();
  }
  fail(e: string) {
    this.cur?.onerror(e);
  }
  get last() {
    return this.spoken[this.spoken.length - 1]?.text;
  }
}

export const OPTS: EngineOptions = {
  rate: 0.5, gapS: 2, pw: 0.5, mode: 'clause', twice: false, punct: false, advance: 'timer', lead: 0, voice: '',
};
