const API = 'https://generativelanguage.googleapis.com/v1beta';

// Ask Google which Flash models this key can use, newest first, instead of guessing names.
let cache: { at: number; names: string[] } | null = null;
export async function models(key: string): Promise<string[]> {
  if (!cache || Date.now() - cache.at > 3_600_000) {
    let names: string[] = [];
    try {
      const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
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
export const resetModelCache = () => { cache = null; };

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

/** Tries the newest Flash models in turn. `accept` turns a Gemini response into a value, or null if it is empty. */
export async function generate<T>(
  apiKey: string, body: unknown, accept: (d: any) => T | null,
): Promise<{ ok: true; value: T; model: string } | { ok: false; last: GeminiFail }> {
  let last: GeminiFail = { status: 502, msg: '' };
  for (const model of await models(apiKey)) {
    let r: Response;
    try {
      r = await fetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      last = { status: 502, msg: `${model}: could not reach Google (${String((e as Error)?.message || e).slice(0, 60)})` };
      continue;
    }
    if (r.ok) {
      const d = await r.json().catch(() => null);
      const v = d ? accept(d) : null;
      if (v) return { ok: true, value: v, model };
      last = { status: 502, msg: 'empty answer from ' + model };
      continue;
    }
    const e = await r.json().catch(() => null);
    last = { status: r.status, msg: `${model}: ${e?.error?.message || r.statusText}` };
    console.error('Gemini error', last.status, last.msg);
    if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(last.msg))) break;
  }
  return { ok: false, last };
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
  if (last.status === 404 || /no longer available|not found/.test(m)) return { code: 'no_model', error: 'No AI model is available right now. Try again later.', status: 502 };
  return { code: 'failed', error: 'The photo could not be processed. Try again, or try a clearer photo.', status: 502 };
}

export { API };
