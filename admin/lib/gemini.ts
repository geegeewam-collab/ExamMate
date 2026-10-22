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

export { API };
