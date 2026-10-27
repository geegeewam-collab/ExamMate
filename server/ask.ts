import { verify, type Store } from './license';
import { json, secret } from './http';
import { describeFailure, generate } from './gemini';

const fail = (code: string, error: string, status: number, detail = '') =>
  json({ code, error, detail: String(detail).slice(0, 240) }, status);

const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,200}$/;

const PROMPT = `You are Exam Mate's voice helper. A student is listening to exam answers read aloud and has just asked you something out loud.
Reply the way you would speak: plain sentences, one to three of them, short and clear.
No markdown, no lists, no symbols. Say maths in words, for example "x squared plus 3".
If the question is about the answers being read, use them as context. If you did not understand the question, say so in one short sentence and ask them to repeat it.`;

/** Keeps spoken answers clean: no markdown characters, one line, not too long. */
export const cleanSpoken = (t: string) => t.replace(/[*_#`>~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 700);

/**
 * POST /api/ask  { question, context?, current? }  ->  { answer }
 * Same rules as /api/answer: needs a valid license; students bring their own Gemini key, the owner uses the server's.
 */
export async function handleAsk(req: Request, store: Store): Promise<Response> {
  if (!secret()) return fail('config', 'The server is missing its settings.', 500);

  const auth = await verify(store, secret(), req.headers.get('x-license-token'), req.headers.get('x-device-id'));
  if (!auth.ok) return fail('license', auth.error, auth.status === 401 ? 401 : 403);

  let apiKey: string;
  if (auth.owner) {
    apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) return fail('config', 'The server has no GEMINI_API_KEY set.', 500);
  } else {
    apiKey = (req.headers.get('x-gemini-key') || '').trim();
    if (!KEY_SHAPE.test(apiKey)) return fail('need_key', 'Add your free Gemini key in Settings to ask questions.', 400);
  }

  if ((await store.hit(`ask:${auth.key}`, 600, 1)) > (auth.owner ? 120 : 40)) return fail('limit', 'Too many questions. Wait a few minutes.', 429);

  let body: any;
  try { body = await req.json(); } catch { return fail('bad', 'Bad request.', 400); }
  const question = String(body?.question ?? '').trim().slice(0, 400);
  if (question.length < 2) return fail('bad', 'No question received.', 400);
  const context = String(body?.context ?? '').slice(0, 6000);
  const current = String(body?.current ?? '').slice(0, 400);

  const text =
    `${PROMPT}\n\nAnswers being read to the student:\n${context || '(none)'}\n\n` +
    `The phrase being read right now: ${current || '(none)'}\n\nStudent asked: ${question}`;

  const out = await generate(
    apiKey,
    { contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 300 } },
    (d) => cleanSpoken((d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || '').join('')) || null,
  );
  if (out.ok) return json({ answer: out.value, model: out.model });
  const f = describeFailure(out.last, auth.owner);
  return fail(f.code, f.error.replace('The photo could not be processed. Try again, or try a clearer photo.', 'I could not get an answer. Try again.'), f.status, out.last.msg);
}
