export type PhraseMode = 'sentence' | 'clause' | 'w5' | 'w3' | 'w2';

export interface Split {
  phrases: string[];
  /** For each phrase, the index of the logical question/paragraph in `lines`. */
  lineOf: number[];
  /** Compact logical lines shown in the reader's question navigator. */
  lines: string[];
  /** True for phrases that are literal source-code lines. */
  codeOf: boolean[];
  /** One-based source line number inside its code block. */
  codeLineNumber: number[];
  /** Character offset in the original normalised source for each spoken phrase. */
  offsetOf: number[];
}

const WORDS: Record<string, number> = { w2: 2, w3: 3, w5: 5 };
export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:—–]["'”’)]*$/;
const FENCE = /^\s*```\s*([a-zA-Z0-9_+.-]*)\s*$/;

function appendProseLine(line: string, lineIndex: number, lineStart: number, mode: PhraseMode, phrases: string[], lineOf: number[], offsetOf: number[]) {
  const n = WORDS[mode] ?? 0;
  const end = mode === 'sentence' ? SENTENCE_END : /[.!?…]["'”’)]*$/;
  const words = Array.from(line.matchAll(/\S+/g));
  let current: string[] = [];
  let currentStart = 0;
  for (const match of words) {
    const word = match[0];
    if (!current.length) currentStart = lineStart + (match.index ?? 0);
    current.push(word);
    // Keep labels attached to their content: "1. Clarity", "Step 1. Open the file".
    const listMarker = current.length === 1 && /^(?:\d{1,3}[.)]|[a-z]\))$/i.test(word);
    const stepMarker = current.length === 2 && /^step$/i.test(current[0]) && /^\d+[.)]?$/i.test(word);
    if (!listMarker && !stepMarker && (end.test(word) || (mode !== 'sentence' && CLAUSE_END.test(word)) || (n > 0 && current.length >= n))) {
      phrases.push(current.join(' '));
      lineOf.push(lineIndex);
      offsetOf.push(currentStart);
      current = [];
    }
  }
  if (current.length) {
    phrases.push(current.join(' '));
    lineOf.push(lineIndex);
    offsetOf.push(currentStart);
  }
}

function looksLikeCode(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  return /^(?:#\s*(?:include|define|ifdef|ifndef|endif|pragma)|(?:int|float|double|char|void|long|short|unsigned|struct|enum|return|if|else|for|while|switch|case|break|continue)\b|[\w:*&]+\s+\w+\s*\([^)]*\)\s*\{?\s*$|\{|\}|\/\/|\/\*)/.test(s)
    || /[;{}]\s*$/.test(s);
}

/**
 * Split prose according to the selected pace, but keep fenced source code line-by-line.
 * Code indentation and punctuation are preserved exactly in `phrases`; TTS gets a separate
 * spoken rendering through `speakCodeLine` so the student can both hear and copy the code.
 */
export function splitText(text: string, mode: PhraseMode): Split {
  const normalized = text.replace(/\r\n?/g, '\n');
  const source = normalized.split('\n');
  const lineStarts: number[] = [];
  let sourceOffset = 0;
  for (const line of source) { lineStarts.push(sourceOffset); sourceOffset += line.length + 1; }
  const phrases: string[] = [];
  const lineOf: number[] = [];
  const lines: string[] = [];
  const codeOf: boolean[] = [];
  const codeLineNumber: number[] = [];
  const offsetOf: number[] = [];

  let i = 0;
  while (i < source.length) {
    const fence = source[i].match(FENCE);
    if (fence) {
      const language = fence[1] || 'code';
      const block: string[] = [];
      i++;
      const blockStart = i;
      while (i < source.length && !/^\s*```\s*$/.test(source[i])) block.push(source[i++]);
      if (i < source.length) i++; // closing fence
      const sourceCount = block.length;
      const logicalIndex = lines.length;
      lines.push(`${language.toUpperCase()} program · ${sourceCount} lines`);
      block.forEach((codeLine, index) => {
        // Empty source lines remain in the code block shown to the student, but are not spoken.
        if (!codeLine.trim()) return;
        phrases.push(codeLine);
        lineOf.push(logicalIndex);
        codeOf.push(true);
        codeLineNumber.push(index + 1);
        offsetOf.push(lineStarts[blockStart + index] ?? 0);
      });
      continue;
    }

    // Graceful fallback for code copied without Markdown fences: group adjacent code-looking lines.
    if (looksLikeCode(source[i]) && i + 1 < source.length && (looksLikeCode(source[i + 1]) || /^\s*\}?\s*$/.test(source[i + 1]))) {
      const block: string[] = [];
      const blockStart = i;
      while (i < source.length && (looksLikeCode(source[i]) || !source[i].trim())) block.push(source[i++]);
      const logicalIndex = lines.length;
      lines.push(`Code · ${block.length} lines`);
      block.forEach((codeLine, index) => {
        if (!codeLine.trim()) return;
        phrases.push(codeLine);
        lineOf.push(logicalIndex);
        codeOf.push(true);
        codeLineNumber.push(index + 1);
        offsetOf.push(lineStarts[blockStart + index] ?? 0);
      });
      continue;
    }

    const logicalIndex = lines.length;
    lines.push(source[i]);
    appendProseLine(source[i], logicalIndex, lineStarts[i], mode, phrases, lineOf, offsetOf);
    // Prose phrases deliberately do not undergo code-symbol expansion.
    const added = phrases.length - codeOf.length;
    for (let j = 0; j < added; j++) {
      codeOf.push(false);
      codeLineNumber.push(0);
    }
    i++;
  }

  return { phrases, lineOf, lines, codeOf, codeLineNumber, offsetOf };
}

const MULTI_SYMBOLS: [RegExp, string][] = [
  [/\\/g, ' backslash '],
  [/>=/g, ' greater than or equal to '],
  [/<=/g, ' less than or equal to '],
  [/!=/g, ' not equal to '],
  [/==/g, ' equals '],
  [/≈/g, ' approximately equal to '],
  [/≠/g, ' not equal to '],
  [/≥/g, ' greater than or equal to '],
  [/≤/g, ' less than or equal to '],
  [/≡/g, ' equivalent to '],
  [/→/g, ' tends to '],
  [/←/g, ' from '],
  [/↔/g, ' if and only if '],
  [/&&/g, ' and '],
  [/\|\|/g, ' or '],
  [/\+\+/g, ' increment '],
  [/--/g, ' decrement '],
  [/\+=/g, ' plus equals '],
  [/-=/g, ' minus equals '],
];

const SYMBOLS: Record<string, string> = {
  '>': ' greater than ', '<': ' less than ', '=': ' equals ',
  '+': ' plus ', '-': ' minus ', '*': ' times ', '/': ' divided by ',
  '×': ' times ', '÷': ' divided by ', '±': ' plus or minus ',
  '^': ' to the power of ', '_': ' underscore ', '%': ' percent ',
  '√': ' square root of ', '∛': ' cube root of ', '∞': ' infinity ',
  'π': ' pi ', 'θ': ' theta ', 'Δ': ' delta ', 'Σ': ' sigma ',
  '∑': ' sum of ', '∏': ' product of ', '∈': ' is an element of ',
  '∉': ' is not an element of ', '∝': ' is proportional to ',
  '∩': ' intersection ', '∪': ' union ', '⊂': ' is a subset of ',
  '⊆': ' is a subset of or equal to ', '°': ' degrees ',
  '≪': ' much less than ', '≫': ' much greater than ',
  '(': ' open parenthesis ', ')': ' close parenthesis ',
  '[': ' open bracket ', ']': ' close bracket ',
  '{': ' open brace ', '}': ' close brace ',
};

/** Convert mathematical/operator glyphs into spoken names without changing the displayed source. */
export function speakSymbols(value: string): string {
  let spoken = value;
  for (const [pattern, replacement] of MULTI_SYMBOLS) spoken = spoken.replace(pattern, replacement);
  spoken = spoken.replace(/[><=+*/×÷±^_%√∛∞πθΔΣ∑∏∈∉∝∩∪⊂⊆°≪≫≠≥≤≡→←↔()[\]{}]/g, (symbol) => SYMBOLS[symbol] ?? symbol);
  spoken = spoken.replace(/(?<![\p{L}\d])-(?![\p{L}\d])/gu, ' minus ');
  return spoken.replace(/\s+/g, ' ').trim();
}

const CODE_WORDS: [RegExp, string][] = [
  [/\b#include\b/gi, 'include'], [/\bprintf\b/gi, 'print f'], [/\bscanf\b/gi, 'scan f'],
  [/\bint\b/gi, 'integer'], [/\bfloat\b/gi, 'float'], [/\bdouble\b/gi, 'double precision'],
  [/\bchar\b/gi, 'character'], [/\bvoid\b/gi, 'void'], [/\breturn\b/gi, 'return'],
  [/\bmain\b/gi, 'main'], [/\bif\b/gi, 'if'], [/\belse\b/gi, 'else'],
  [/\bfor\b/gi, 'for'], [/\bwhile\b/gi, 'while'], [/\bdo\b/gi, 'do'],
  [/\bbreak\b/gi, 'break'], [/\bcontinue\b/gi, 'continue'],
];

/** Speak one source-code line as code, with explicit line transitions and spoken punctuation. */
export function speakCodeLine(source: string, lineNumber: number): string {
  const line = source.trim();
  const prefix = lineNumber <= 1 ? 'Line one. ' : `Next line. Line ${lineNumber}. `;
  if (!line) return `${prefix}Blank line.`;
  if (/^#\s*include\s*[<"]stdio\.h[>"]/.test(line)) {
    return `${prefix}Include the standard input and output header file, S T D I O dot H.`;
  }
  if (/^#\s*include\s*[<"]/.test(line)) {
    const name = line.match(/[<"]([^>"]+)[>"]/)?.[1] ?? 'header file';
    return `${prefix}Include header file ${name.replace(/\./g, ' dot ')}.`;
  }
  if (/^\/\//.test(line)) return `${prefix}Comment. ${line.slice(2).trim()}`;
  if (/^\}$/.test(line)) return `${prefix}Close brace.`;

  let spoken = line;
  // Make common escape sequences intelligible without reading them as accidental punctuation.
  spoken = spoken.replace(/\\n/g, ' backslash n ').replace(/\\t/g, ' backslash t ').replace(/\\r/g, ' backslash r ').replace(/\\\\/g, ' backslash ');
  for (const [pattern, replacement] of CODE_WORDS) spoken = spoken.replace(pattern, replacement);
  const codeSymbols: Record<string, string> = {
    '#': ' hash ', '<': ' less than ', '>': ' greater than ',
    '(': ' open parenthesis ', ')': ' close parenthesis ',
    '{': ' open brace ', '}': ' close brace ',
    '[': ' open bracket ', ']': ' close bracket ',
    ';': ' semicolon ', ',': ' comma ', ':': ' colon ',
    '.': ' dot ', '=': ' assignment operator ',
    '+': ' plus ', '-': ' minus ', '*': ' asterisk ',
    '/': ' slash ', '&': ' ampersand ', '!': ' exclamation mark ', '\\': ' backslash ',
    '"': ' quote ', "'": ' apostrophe ', '%': ' percent ',
  };
  // Preserve comparison and compound operators as single concepts before single-character symbols.
  spoken = spoken
    .replace(/>=/g, ' greater than or equal sign ')
    .replace(/<=/g, ' less than or equal to ')
    .replace(/==/g, ' equals ')
    .replace(/!=/g, ' not equal to ')
    .replace(/\+=/g, ' plus equals ')
    .replace(/-=\s*/g, ' minus equals ')
    .replace(/->/g, ' arrow ')
    .replace(/&&/g, ' logical and ')
    .replace(/\|\|/g, ' logical or ');
  spoken = spoken.replace(/[<>()[\]{};,:.=+*/&!'"%#-]/g, (symbol) => codeSymbols[symbol] ?? symbol);
  return `${prefix}${spoken.replace(/\s+/g, ' ').trim()}.`;
}

const PUNCTUATION: Record<string, string> = {
  ',': 'comma', ';': 'semicolon', ':': 'colon', '.': 'full stop',
  '?': 'question mark', '!': 'exclamation mark',
};
/** Optional punctuation mode. Mathematical symbols have already been verbalised separately. */
export const speakPunctuation = (value: string) =>
  value.replace(/([,;:.?!])(?=\s|$)/g, (symbol) => ` ${PUNCTUATION[symbol]} `).replace(/\s+/g, ' ').trim();

/** Extract the most relevant local context around the current phrase, including repeated phrases. */
export function windowAround(text: string, current: string, max: number, preferredAt?: number): string {
  if (!Number.isFinite(max) || max <= 0) return '';
  if (text.length <= max) return text;
  let at = -1;
  if (current) {
    const matches: number[] = [];
    let cursor = 0;
    while (cursor <= text.length - current.length) {
      const found = text.indexOf(current, cursor);
      if (found < 0) break;
      matches.push(found);
      cursor = found + Math.max(1, current.length);
    }
    if (matches.length) {
      const target = Number.isFinite(preferredAt) ? Number(preferredAt) : matches[0];
      at = matches.reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best, matches[0]);
    }
  }
  const centre = at >= 0 ? at + Math.floor(current.length / 2) : Math.max(0, Math.min(preferredAt ?? 0, text.length));
  const size = Math.min(text.length, Math.floor(max));
  const start = Math.max(0, Math.min(centre - Math.floor(size * 0.35), text.length - size));
  return text.slice(start, start + size);
}
