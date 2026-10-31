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

/** `used` = how many words of the transcript the wake phrase (and anything said before it) took up. */
export interface WakeMatch { matched: boolean; rest: string; used: number }

/**
 * Does the transcript contain the wake phrase? Tolerates small mis-hearings ("exam mate", "examate", "x am mate").
 * A phrase like "hey exam mate" also matches "exam mate" alone. `rest` is whatever was said after it.
 */
export function matchWake(transcript: string, phrase: string): WakeMatch {
  const t = normalize(transcript).split(' ').filter(Boolean);
  let p = normalize(phrase).split(' ').filter(Boolean);
  if (!t.length || !p.length) return { matched: false, rest: '', used: 0 };
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
    if (best) return { matched: true, rest: t.slice(start + best.len).join(' '), used: start + best.len };
  }
  return { matched: false, rest: '', used: 0 };
}

/**
 * The engine often revises what it already heard ("hey buddy" becomes "hey body", or "hey a x mate"). For a later transcript of the
 * SAME utterance, remove the wake words from the start and return what was said after them. `heard` is the wake words as first
 * heard and `used` how many words that was; the cut is placed where the start best resembles `heard`, give or take one word.
 */
export function dropWakeWords(transcript: string, heard: string, used: number): string {
  const t = normalize(transcript).split(' ').filter(Boolean);
  const w = heard.replace(/ /g, '');
  let cut = Math.min(used, t.length);
  let bestD = Infinity;
  for (let n = Math.max(1, used - 1); n <= Math.min(used + 1, t.length); n++) {
    const d = lev(t.slice(0, n).join(''), w);
    if (d < bestD || (d === bestD && n === used)) { bestD = d; cut = n; }
  }
  return t.slice(cut).join(' ');
}

export type Command = 'repeat' | 'next' | 'back' | 'pause' | 'resume' | 'stop' | 'slower' | 'faster';

const RULES: [Command, RegExp][] = [
  ['repeat', /^(please )?(repeat( that| it| this| the (last|current|previous) (one|phrase|part|sentence|bit))?|say (that|it|this|the last (part|bit|phrase)) (again|one more time)|read (that|it|this|the last (part|bit|phrase)) again|again|one more time|come again|i missed that|i didnt catch (that|it|the last part)|what did you say)( please)?$/],
  ['next', /^(please )?(next( one| phrase| part| section)?|skip( that| this| it| this part| this phrase)?|move on|move to the next (one|phrase|part|section)|go to the next( one| phrase| part| section)?|carry on to the next( part| phrase| section)?|forward|next section|next question)( please)?$/],
  ['back', /^(please )?(back|back one|go back( one| a bit| a little| in the text| to the (previous|last) (one|phrase|part|section|sentence))?|take me back|take me to the previous (one|phrase|part|section|sentence)|previous( one| phrase| part| section| sentence)?|go to the previous( one| phrase| part| section| sentence)?|the one before( that)?|one (phrase|part|step) back|before that|we passed it)( please)?$/],
  ['pause', /^(please )?(pause|wait|wait a (second|sec|moment|minute)|hold on|hang on|hold|give me a (second|sec|moment)|stop for a (second|moment))( please)?$/],
  ['resume', /^(please )?(continue|resume|resume reading|carry on|keep going|go on|go ahead|play|start reading|im ready|im ready now)( please)?$/],
  ['stop', /^(please )?(stop( reading| it| now)?|thats enough|enough|quit|end|end reading|cancel|finish reading|stop the reading)( please)?$/],
  ['slower', /^(please )?(slower|slow down|read slower|speak slower|too fast|a little slower|a bit slower|take it slower)( please)?$/],
  ['faster', /^(please )?(faster|speed up|speed it up|read faster|speak faster|too slow|a little faster|a bit faster|a little quicker|a bit quicker)( please)?$/],
];

/** Whole-utterance commands only, so a real question that merely contains "next" is never mistaken for one. */
export function parseCommand(text: string): Command | null {
  const n = normalize(text);
  if (!n || n.split(' ').length > 7) return null;
  for (const [cmd, re] of RULES) if (re.test(n)) return cmd;
  return null;
}
