import { kv } from './storage';
import type { PhraseMode } from './text';
import type { WakeChoice } from './voice/wake';

export interface Settings {
  rate: number;
  gapS: number;
  pw: number;
  mode: PhraseMode;
  twice: boolean;
  punct: boolean;
  advance: 'timer' | 'tap';
  lead: 0 | 3 | 5;
  voice: string;
  style: 'quick' | 'learn';
  auto: boolean;
  /** Voice assistant: ask questions out loud while reading. Off until the student turns it on. */
  assist: boolean;
  wakeListen: boolean;
  wake: WakeChoice;
  wakeCustom: string;
  /** How long to hold the on-screen button before it listens. 0 = a simple tap. */
  holdMs: 0 | 1000 | 3000;
  earbudAsk: boolean;
}

export const DEFAULTS: Settings = {
  rate: 0.5, gapS: 2, pw: 0.75, mode: 'clause', twice: false, punct: false,
  advance: 'timer', lead: 0, voice: '', style: 'quick', auto: true,
  assist: false, wakeListen: true, wake: 'exam', wakeCustom: '', holdMs: 3000, earbudAsk: false,
};

export const PRESETS: Record<'notes' | 'careful' | 'normal', Partial<Settings>> = {
  notes: { rate: 0.5, gapS: 2, pw: 0.75, mode: 'w3', twice: false },
  careful: { rate: 0.4, gapS: 3, pw: 1.25, mode: 'w2', twice: true },
  normal: { rate: 0.9, gapS: 0.5, pw: 0, mode: 'sentence', twice: false },
};

const clamp = (n: unknown, lo: number, hi: number, d: number) =>
  typeof n === 'number' && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
const oneOf = <T extends string | number>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export function loadSettings(): Settings {
  const s = kv.get<Partial<Settings>>('settings', {});
  return {
    rate: clamp(s.rate, 0.1, 1.2, DEFAULTS.rate),
    gapS: clamp(s.gapS, 0, 15, DEFAULTS.gapS),
    pw: clamp(s.pw, 0, 2, DEFAULTS.pw),
    mode: oneOf(s.mode, ['sentence', 'clause', 'w5', 'w3', 'w2'] as const, DEFAULTS.mode),
    twice: s.twice === true,
    punct: s.punct === true,
    advance: oneOf(s.advance, ['timer', 'tap'] as const, 'timer'),
    lead: oneOf(s.lead, [0, 3, 5] as const, 0),
    voice: typeof s.voice === 'string' ? s.voice : '',
    style: oneOf(s.style, ['quick', 'learn'] as const, 'quick'),
    auto: s.auto !== false,
    assist: s.assist === true,
    wakeListen: s.wakeListen !== false,
    wake: oneOf(s.wake, ['exam', 'reader', 'hello', 'custom'] as const, 'exam'),
    wakeCustom: typeof s.wakeCustom === 'string' ? s.wakeCustom.slice(0, 40) : '',
    holdMs: oneOf(s.holdMs, [0, 1000, 3000] as const, 3000),
    earbudAsk: s.earbudAsk === true,
  };
}

export const saveSettings = (s: Settings) => kv.set('settings', s);

/* History and resume */
export interface HistoryItem { t: number; text: string }
export const loadHistory = (): HistoryItem[] => {
  const h = kv.get<HistoryItem[]>('history', []);
  return Array.isArray(h) ? h.filter((x) => x && typeof x.text === 'string').slice(0, 20) : [];
};
export const saveHistory = (h: HistoryItem[]) => kv.set('history', h.slice(0, 20));

export interface Resume { text: string; idx: number }
export const loadResume = (): Resume | null => {
  const r = kv.get<Resume | null>('resume', null);
  return r && typeof r.text === 'string' && r.text && r.idx > 0 ? r : null;
};

/* Photos answered today (on this device) */
export function photosToday(add = false): number {
  const d = new Date().toDateString();
  let c = kv.get<{ d: string; n: number }>('count', { d, n: 0 });
  if (c.d !== d) c = { d, n: 0 };
  if (add) {
    c.n++;
    kv.set('count', c);
  }
  return c.n;
}
