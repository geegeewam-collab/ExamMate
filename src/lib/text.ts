export type PhraseMode = 'sentence' | 'clause' | 'w5' | 'w3' | 'w2';

export interface Split {
  phrases: string[];
  /** For each phrase, the index of the text line (question) it came from. */
  lineOf: number[];
  lines: string[];
}

const WORDS: Record<string, number> = { w2: 2, w3: 3, w5: 5 };

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Splits text into the phrases that get read one at a time. */
export function splitText(text: string, mode: PhraseMode): Split {
  const n = WORDS[mode] ?? 0;
  const end = mode === 'sentence' ? /[.!?…]["'”’)\]]*$/ : /[.!?…,;:—–]["'”’)\]]*$/;
  const lines = text.split(/\n+/);
  const phrases: string[] = [];
  const lineOf: number[] = [];

  lines.forEach((line, li) => {
    let cur: string[] = [];
    line
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach((w) => {
        cur.push(w);
        if (end.test(w) || (n && cur.length >= n)) {
          phrases.push(cur.join(' '));
          lineOf.push(li);
          cur = [];
        }
      });
    if (cur.length) {
      phrases.push(cur.join(' '));
      lineOf.push(li);
    }
  });

  return { phrases, lineOf, lines };
}

const SAY: Record<string, string> = {
  ',': 'comma',
  ';': 'semicolon',
  ':': 'colon',
  '.': 'full stop',
  '?': 'question mark',
  '!': 'exclamation mark',
};

/** "Say punctuation aloud": turns , . ? etc. into spoken words. */
export const speakPunctuation = (t: string) =>
  t.replace(/([,;:.?!])(?=\s|$)/g, (m) => ' ' + SAY[m] + ' ');

/** The part of a long text around the phrase being read (what the AI needs), so each question stays small and quick. */
export function windowAround(text: string, current: string, max: number): string {
  if (text.length <= max) return text;
  const at = current ? text.indexOf(current) : -1;
  const centre = at >= 0 ? at + Math.floor(current.length / 2) : 0;
  const start = Math.max(0, Math.min(centre - Math.floor(max * 0.35), text.length - max));
  return text.slice(start, start + max);
}
