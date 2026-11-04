import { EXAM_STUDENT_ANSWER_STYLE } from './student-answer-style';

const API = 'https://generativelanguage.googleapis.com/v1beta';

// Ask Google which Flash models this key can use, newest first, instead of guessing names.
let cache: { at: number; names: string[] } | null = null;
export async function models(key: string, signal?: AbortSignal): Promise<string[]> {
  if (!cache || Date.now() - cache.at > 3_600_000) {
    let names: string[] = [];
    try {
      const timeout = AbortSignal.timeout(6000);
      const combined = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout;
      const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: combined });
      if (r.ok) {
        const d = await r.json();
        names = (d.models ?? [])
          .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
          .map((m: any) => String(m.name).replace('models/', ''))
          .filter((n: string) => n.startsWith('gemini-') && n.includes('flash') && !/tts|image|live|audio|embedding|robotics|computer/.test(n));
      }
    } catch {}
    const v = (n: string) => parseFloat(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');
    const score = (n: string) => v(n) * 10 - (n.includes('lite') ? 1 : 0) - (/preview|exp/.test(n) ? 0.5 : 0);
    names.sort((a, b) => score(b) - score(a));
    if (names.length) cache = { at: Date.now(), names };
    else return ['gemini-flash-latest', 'gemini-2.5-flash'];
  }
  const pinned = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [];
  return [...pinned, ...cache.names, 'gemini-flash-latest'].filter((m, i, a) => a.indexOf(m) === i).slice(0, 5);
}
export const resetModelCache = () => { cache = null; working.clear(); };

/*
 * A photographed exam is answered in two steps so that a long paper costs no more time per question than a short one:
 *   1. READ: one call with the photos lists the questions (short output, so it is quick).
 *   2. ANSWER: the questions are split into small groups and every group is answered at the same time.
 * One big call that reads, thinks about and answers 15 questions in a single response is what used to run out of time.
 */

export interface ExamQuestion { label: string; text: string }

export const readPrompt = `The attached images are photos of a page of questions, in order. List every question you can read, in the order they appear. Do not answer anything.
- label: the question number as shown in the photo, like "Question 1" or "Question 2 b". If a question has parts such as (a), (b) or (i), (ii), give each part its own item. If the numbering starts again in a new section, put the section first, like "Section B, Question 1 a".
- text: the full wording of that question, copied as written, keeping words like THREE or FOUR. For a part, start with the lead-in sentence of its question so the part makes sense on its own. Leave out marks such as (3 marks), section headings and exam instructions.
- If a number is cut off at the edge of the photo, carry on the numbering from the question before it. Never skip a question because its number is missing.
- If part of a question is unreadable, copy what you can and write [unreadable] for the rest. If it depends on a diagram or table, end its text with [see diagram].
- Do not add extra questions, an introduction or commentary.`;

export const readSchema = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['label', 'text'] } } },
  required: ['questions'],
};

/** The questions the model read. `null` means the reply was not usable; an empty list means it read the photo but found no questions. */
export function parseQuestions(raw: string): ExamQuestion[] | null {
  try {
    const q = JSON.parse(raw).questions;
    if (!Array.isArray(q)) return null;
    return q
      .map((x: any) => ({ label: String(x.label ?? '').replace(/[.\s]+$/, '').trim(), text: String(x.text ?? '').replace(/\s+/g, ' ').trim() }))
      .filter((x) => x.text);
  } catch {
    return null;
  }
}

export const answerPrompt = (mode: 'quick' | 'learn', questions: ExamQuestion[]) => `The attached images are photos of an exam page. Use them only to see a diagram, table or detail that the wording below leaves out. Answer ONLY the numbered questions listed below, one answer each.
${EXAM_STUDENT_ANSWER_STYLE}

Your answers will be read aloud by a text-to-speech voice one line at a time, and written down by hand, so the SHAPE of each answer matters as much as its content.

Output for each question: n (its number in the list below) and lines (an array of strings). Every string in lines is ONE line that the student hears and writes on its own. Never put several points in one string.
- Do NOT repeat or rephrase the question, and do not add the question number or label. Start straight with the answer.
- Use plain text for ordinary answers. Keep mathematical symbols in their correct written form; never replace a symbol with its spoken words. For example, write "x² + 3", "5/8", "x ≥ 10" and "a × b" using the appropriate symbols.
- For a question asking for a program or source code, return a complete, runnable solution in a fenced code block labelled with its language (for example, language label C). Put each source-code line in its own lines-array element. Preserve indentation, braces, operators, quotes, semicolons, comments, and blank lines exactly. Do not turn code into prose or put several source lines into one array element. Add only a short explanation outside the code block when the question asks for an explanation.
- For multiple choice, give the option letter and then the option text.
- If a question is unreadable or something is missing, give one line saying so. No introduction or commentary.

Choose the shape from the wording of the question:
1. A number of points is asked (state, name, list, identify, outline, give THREE or FOUR ...): exactly that many lines, numbered "1. ...", "2. ...", "3. ...". Each line is a short point, one idea per line.
2. A number of points to explain, discuss, describe or evaluate (explain THREE advantages, discuss THREE characteristics, ...): give exactly that many numbered points. Put each point's name and its explanation together in one natural, complete line, for example, "1. Saves time: a spreadsheet calculates totals automatically, so less work is done by hand."
3. A procedure, steps, "how can one", "outline how", "analyze how one can apply": first an optional line saying what is being done, then one line per step, "Step 1. ...", "Step 2. ...", in order. Include every step needed, and nothing else.
4. Distinguish, differentiate or compare two things: one line for each, like "Formula: ..." and "Function: ...", then if useful one line starting "Difference: ".
5. Define, explain the term, describe the purpose, or identify one thing: one single line, a complete sentence or the exact term.
6. Several kinds are asked in one question (for example three types, each with an example): number each type on its own line, then a line starting "- " with its short explanation, then a line starting "- Example: ".
7. A calculation: the working as one short line per step, then a last line "Answer: ...".
When a question gives a number of marks, match the amount of detail to it. The number of points asked ALWAYS wins: THREE means exactly three numbered points.

${mode === 'learn'
  ? 'This is learn mode. Start with the same direct, exam-ready answer required above. Then add further teaching only when it genuinely helps with this question: show working for calculations, explain the reasoning for a concept, or give a short relevant example when it makes the idea clearer. Do not automatically append Method, Example or other template sections to every answer. Do not change the number of required answer points; keep any extra teaching clearly separate and concise.'
  : 'This is quick mode: give the direct, natural exam-ready answer and keep each line as brief as the question allows. Do not omit context needed to make a point understandable. For calculations, give the necessary working and final result.'}

Questions:
${questions.map((q, i) => `${i + 1}. [${q.label}] ${q.text}`).join('\n')}`;

export const answerSchema = {
  type: 'OBJECT',
  properties: { answers: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, lines: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['n', 'lines'] } } },
  required: ['answers'],
};

/**
 * Cleans one answer into separate lines. Each point stays on its own line so the reader can speak and show it on its own.
 * Safety net: if the model still wrote "1. a 2. b 3. c" or "Step 1. a Step 2. b" in a single line, it is split into its points.
 */
export function toLines(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map((x) => String(x ?? '')).join('\n') : String(input ?? '');
  const source = raw.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  let inCode = false;
  for (const original of source) {
    const trimmed = original.trim();
    if (/^```[a-zA-Z0-9_+.-]*\s*$/.test(trimmed)) {
      lines.push(trimmed);
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      // Source code is data: indentation and every operator must survive unchanged.
      lines.push(original.replace(/\t/g, '    '));
      continue;
    }
    const prose = trimmed
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__((?:[^_]|_(?!_))+?)__/g, '$1')
      .replace(/(?<!\*)\*([^\s*](?:[^*]*?[^\s*])?)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_([^\s_](?:[^_]*?[^\s_])?)_(?!_)/g, '$1')
      .replace(/\s+/g, ' ');
    if (prose) lines.push(prose);
  }

  // Safety net for a model that ignored the line-array instruction. Only split a clean,
  // sequential numbered list; never split prose such as "version 2. of the manual" or code.
  if (lines.length === 1 && !lines[0].includes('```') && !/[{};#]/.test(lines[0])) {
    const value = lines[0];
    const matches = [...value.matchAll(/(?:^|\s)(?:step\s+)?(\d{1,2})[.)]\s+/gi)];
    if (matches.length >= 2 && Number(matches[0][1]) === 1 && matches.every((m, i) => Number(m[1]) === i + 1)) {
      const starts = matches.map((m) => (m.index ?? 0) + (m[0].startsWith(' ') ? 1 : 0));
      lines.splice(0, 1, ...starts.map((at, i) => value.slice(at, starts[i + 1] ?? value.length).trim()).filter(Boolean));
    }
  }
  return lines;
}

/** Answers by question number (1-based, as numbered in the prompt), so a reordered or skipped answer can never land on the wrong question. Lines are joined with "\n". */
export function parseAnswers(raw: string): Map<number, string> | null {
  try {
    const a = JSON.parse(raw).answers;
    if (!Array.isArray(a)) return null;
    const out = new Map<number, string>();
    for (const x of a) {
      const n = Number(x?.n);
      const text = toLines(x?.lines ?? x?.answer).join('\n');
      if (Number.isInteger(n) && text && !out.has(n)) out.set(n, text);
    }
    return out.size ? out : null;
  } catch {
    return null;
  }
}

/** All the text of a Gemini reply, joined. */
export const replyText = (d: any): string => (d?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || '').join('').trim();

export interface GeminiFail { status: number; msg: string }

/** One HTTP call to Google: which model, what came back, how long it took. Shown to the owner so a slow answer can be explained. */
export interface CallTrace { model: string; status: number; ms: number; note?: string }

export interface GenerateOptions {
  /** Models to try first, in order, without a lookup (fast path). */
  models?: string[];
  /** Longest a single model call may take. */
  timeoutMs?: number;
  /** Total time budget across all models, so retries can never run past the function limit. */
  deadlineMs?: number;
  /** Ask the model to think as little as it can (fast spoken answers), using whichever setting that model accepts. */
  noThinking?: boolean;
  /** Skip the extra model-list HTTP request; useful for latency-sensitive endpoints with explicit fallbacks. */
  discoverModels?: boolean;
  /** Abort upstream provider requests when the incoming client request is cancelled. */
  signal?: AbortSignal;
}

/**
 * How to ask a model to think less, newest style first. Gemini 3.x takes `thinkingLevel` (and thinks at full depth if it is not set);
 * Gemini 2.5 takes `thinkingBudget: 0`; some models take neither. A model that refuses one setting answers 400 within a fraction of a
 * second, so we simply step down to the next, and remember which one worked for that model.
 */
const LADDER: ({ thinkingLevel: string } | { thinkingBudget: number } | null)[] = [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];
const RUNG_NAME = ['thinkingLevel minimal', 'thinkingLevel low', 'thinkingBudget 0', 'no thinking setting'];
const firstRung = (model: string) => (/gemini-2[.-]/.test(model) ? 2 : 0);
const working = new Map<string, number>(); // model -> the rung that last worked (kept while the server instance is warm)

/** Tries the newest Flash models in turn. `accept` turns a Gemini response into a value, or null if it is empty. */
export async function generate<T>(
  apiKey: string, body: any, accept: (d: any) => T | null, opts: GenerateOptions = {},
): Promise<{ ok: true; value: T; model: string; trace: CallTrace[] } | { ok: false; last: GeminiFail; trace: CallTrace[] }> {
  const started = Date.now();
  const trace: CallTrace[] = [];
  const deadline = opts.deadlineMs ?? 55_000;
  const perCall = opts.timeoutMs ?? 40_000;
  let last: GeminiFail = { status: 502, msg: '' };

  const call = async (model: string, payload: unknown): Promise<{ r: Response } | { err: GeminiFail }> => {
    const left = deadline - (Date.now() - started);
    if (left < 1500) return { err: { status: 504, msg: 'time budget used up' } };
    if (opts.signal?.aborted) return { err: { status: 499, msg: `${model}: client cancelled the request` } };
    const ctl = new AbortController();
    const abortParent = () => ctl.abort();
    opts.signal?.addEventListener('abort', abortParent, { once: true });
    const t = setTimeout(() => ctl.abort(), Math.min(perCall, left));
    try {
      const r = await fetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      return { r };
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      return { err: { status: aborted ? (opts.signal?.aborted ? 499 : 504) : 502, msg: `${model}: ${opts.signal?.aborted ? 'client cancelled the request' : aborted ? 'took too long' : 'could not reach Google'}` } };
    } finally {
      clearTimeout(t);
      opts.signal?.removeEventListener('abort', abortParent);
    }
  };

  /** Same as `call`, but remembers how long it took and what came back (including Google's own words when it said no). */
  const timed = async (model: string, payload: unknown, note?: string) => {
    const t0 = Date.now();
    const res = await call(model, payload);
    const ms = Date.now() - t0;
    let n = note ?? '';
    if ('r' in res && !res.r.ok) {
      const e = await res.r.clone().json().catch(() => null);
      n = [n, String(e?.error?.message || res.r.statusText || '').replace(/\s+/g, ' ').slice(0, 140)].filter(Boolean).join(': ');
    }
    trace.push({ model, status: 'r' in res ? res.r.status : res.err.status, ms, ...(n ? { note: n } : {}) });
    return res;
  };

  const tried = new Set<string>();
  const batches: (() => Promise<string[]>)[] = [];
  if (opts.models?.length) batches.push(async () => opts.models!);
  if (opts.discoverModels !== false) batches.push(() => models(apiKey, opts.signal)); // only looked up when the caller allows discovery

  outer: for (const getBatch of batches) {
    for (const model of await getBatch()) {
      if (tried.has(model)) continue;
      tried.add(model);

      const withThinking = (t: (typeof LADDER)[number]) => (t ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: t } } : body);
      let rung = opts.noThinking ? working.get(model) ?? firstRung(model) : LADDER.length - 1;
      let res = opts.noThinking ? await timed(model, withThinking(LADDER[rung]), RUNG_NAME[rung]) : await timed(model, body);
      // A 400 means this model does not take that setting (or does not like the request): step down to the next one.
      while (opts.noThinking && 'r' in res && res.r.status === 400 && rung < LADDER.length - 1) {
        const e = await res.r.clone().json().catch(() => null);
        if (/api key/i.test(String(e?.error?.message || ''))) break;
        rung++;
        res = await timed(model, withThinking(LADDER[rung]), RUNG_NAME[rung]);
      }
      if (opts.noThinking && 'r' in res && res.r.ok) working.set(model, rung);

      if ('err' in res) {
        last = res.err;
        if (res.err.status === 504 && /budget/.test(res.err.msg)) break outer;
        continue;
      }
      const r = res.r;
      if (r.ok) {
        const d = await r.json().catch(() => null);
        const v = d ? accept(d) : null;
        if (v) return { ok: true, value: v, model, trace };
        last = { status: 502, msg: 'empty answer from ' + model };
        continue;
      }
      const e = await r.json().catch(() => null);
      last = { status: r.status, msg: `${model}: ${e?.error?.message || r.statusText}` };
      console.error('Gemini error', last.status, last.msg);
      if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(last.msg))) break outer;
    }
  }
  return { ok: false, last, trace };
}

/** Plain-language explanation of a Gemini failure, different for students (own key) and the owner (server key). */
export function describeFailure(last: GeminiFail, owner: boolean): { code: string; error: string; status: number } {
  const m = last.msg.toLowerCase();
  if (last.status === 401 || last.status === 403 || /api key/.test(m)) {
    return owner
      ? { code: 'bad_key', error: "The server's Gemini key was rejected. Check GEMINI_API_KEY.", status: 502 }
      : { code: 'student_key', error: 'Google did not accept your Gemini key. Check it in Settings.', status: 400 };
  }
  if (last.status === 429) {
    return owner
      ? { code: 'rate_limited', error: 'The AI service is busy. Wait a minute and try again.', status: 429 }
      : { code: 'student_limit', error: "You've used up your free Gemini allowance for now. Wait a minute, or try again later today.", status: 429 };
  }
  if (last.status === 504) return { code: 'slow', error: 'The AI is taking too long right now. Try again in a moment.', status: 504 };
  if (last.status === 404 || /no longer available|not found/.test(m)) return { code: 'no_model', error: 'No AI model is available right now. Try again later.', status: 502 };
  return { code: 'failed', error: 'The photo could not be processed. Try again, or try a clearer photo.', status: 502 };
}

export { API };
