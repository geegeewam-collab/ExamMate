/** Wake phrase and spoken-command matching. Pure functions: no browser APIs, fully tested. */

const GREETINGS = ['hey', 'hi', 'hello', 'okay', 'ok'];

export const normalize = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/'/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const tolerance = (len: number) => (len <= 5 ? 0 : len <= 8 ? 1 : 2);

export const WAKE_PRESETS = {
  exam: { label: 'Hey Exam Mate', phrase: 'hey exam mate' },
  reader: { label: 'Hey Reader', phrase: 'hey reader' },
  hello: { label: 'Hello Mate', phrase: 'hello mate' },
} as const;
export type WakeChoice = keyof typeof WAKE_PRESETS | 'custom';

/** The phrase to listen for. A custom phrase needs at least 6 letters, otherwise it would trigger constantly. */
export function wakePhrase(choice: WakeChoice, custom: string): string {
  if (choice === 'custom') {
    const c = normalize(custom);
    if (c.replace(/\s/g, '').length >= 6) return c;
    return WAKE_PRESETS.exam.phrase;
  }
  return WAKE_PRESETS[choice]?.phrase ?? WAKE_PRESETS.exam.phrase;
}

export interface WakeMatch { matched: boolean; rest: string }

/**
 * Does the transcript contain the wake phrase? Tolerates small mis-hearings ("exam mate", "examate", "x am mate").
 * A phrase like "hey exam mate" also matches "exam mate" alone. `rest` is whatever was said after it.
 */
export function matchWake(transcript: string, phrase: string): WakeMatch {
  const t = normalize(transcript).split(' ').filter(Boolean);
  let p = normalize(phrase).split(' ').filter(Boolean);
  if (!t.length || !p.length) return { matched: false, rest: '' };
  if (p.length >= 3 && GREETINGS.includes(p[0])) p = p.slice(1);
  const target = p.join('');
  const tol = tolerance(target.length);

  for (let start = 0; start < t.length; start++) {
    let best: { len: number; d: number } | null = null;
    for (let len = Math.max(1, p.length - 1); len <= Math.min(p.length + 1, t.length - start); len++) {
      const win = t.slice(start, start + len).join('');
      if (Math.abs(win.length - target.length) > 3) continue;
      const d = lev(win, target);
      if (d <= tol && (!best || d < best.d || (d === best.d && len > best.len))) best = { len, d };
    }
    if (best) return { matched: true, rest: t.slice(start + best.len).join(' ') };
  }
  return { matched: false, rest: '' };
}

export type Command = 'repeat' | 'next' | 'back' | 'pause' | 'resume' | 'stop' | 'slower' | 'faster';

const RULES: [Command, RegExp][] = [
  ['repeat', /^(please )?(repeat( that| it| the last one)?|say (that|it) again|again|one more time|come again|read (that|it) again)( please)?$/],
  ['next', /^(please )?(next( one| phrase| part)?|skip( that| this| it)?|move on|go to the next( one)?)( please)?$/],
  ['back', /^(please )?(back|go back( one)?|previous( one| phrase)?|go to the previous( one)?|before that)( please)?$/],
  ['pause', /^(please )?(pause|wait|hold on|hang on|hold)( please| a (second|sec|moment))?$/],
  ['resume', /^(please )?(continue|resume|carry on|keep going|go on|go ahead|play)( please)?$/],
  ['stop', /^(please )?(stop( reading| it)?|thats enough|enough|quit|end|cancel)( please)?$/],
  ['slower', /^(please )?(slower|slow down|read slower|speak slower|too fast)( please)?$/],
  ['faster', /^(please )?(faster|speed up|read faster|speak faster|too slow)( please)?$/],
];

/** Whole-utterance commands only, so a real question that merely contains "next" is never mistaken for one. */
export function parseCommand(text: string): Command | null {
  const n = normalize(text);
  if (!n || n.split(' ').length > 5) return null;
  for (const [cmd, re] of RULES) if (re.test(n)) return cmd;
  return null;
}
