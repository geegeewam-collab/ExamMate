const API = 'https://generativelanguage.googleapis.com/v1beta';

// Ask Google which Flash models this key can use, newest first, instead of guessing names.
let cache: { at: number; names: string[] } | null = null;
export async function models(key: string): Promise<string[]> {
  if (!cache || Date.now() - cache.at > 3_600_000) {
    let names: string[] = [];
    try {
      const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(6000) });
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

export const prompt = (mode: string) => `The attached images are photos of a page of questions, in order. Answer every question you can read.
Your answers will be read aloud by a text-to-speech voice and written down by hand, so:
- Plain text only: no markdown, asterisks, hashes, tables or LaTeX. Never use line breaks inside an answer.
- label: the question number as shown in the photo, like "Question 1" or "Question 2 b".
- answer: ${mode === 'learn' ? 'the answer, then the method in a few short steps, then one short worked example. Keep it clear and easy to follow when spoken.' : 'just the answer, as briefly as the question allows. For calculations give the final result only.'}
- Write maths and symbols as words, for example "x squared plus 3" or "five over eight".
- For multiple choice, say the letter and then the option text.
- If a question is unreadable or something is missing, say so in one short sentence as its answer.
- Do not add extra questions, an introduction or commentary.`;

export const schema = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, answer: { type: 'STRING' } }, required: ['label', 'answer'] } } },
  required: ['questions'],
};

export function parse(raw: string): { label: string; answer: string }[] {
  try {
    const q = JSON.parse(raw).questions;
    return (Array.isArray(q) ? q : [])
      .map((x: any) => ({ label: String(x.label ?? '').replace(/[.\s]+$/, '').trim(), answer: String(x.answer ?? '').replace(/\s+/g, ' ').trim() }))
      .filter((x) => x.answer);
  } catch {
    return [];
  }
}

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
    const ctl = new AbortController();
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
      return { err: { status: aborted ? 504 : 502, msg: `${model}: ${aborted ? 'took too long' : 'could not reach Google'}` } };
    } finally {
      clearTimeout(t);
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
  if (opts.discoverModels !== false) batches.push(() => models(apiKey)); // only looked up when the caller allows discovery

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
