import { verify, type Store } from './license';
import { json, secret } from './http';
import { answerPrompt, answerSchema, describeFailure, generate, parseAnswers, parseQuestions, readPrompt, readSchema, replyText, type GeminiFail } from './gemini';

const fail = (code: string, error: string, status: number, detail = '') =>
  json({ code, error, detail: String(detail).slice(0, 240) }, status);

const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,200}$/;

// The route may run for 60 s on Vercel. A typical paper takes 10 to 25 s; these limits only matter when Google is slow, and
// they keep the worst case (read, then answer) inside the 60 s with room for the license check and the reply.
export const TOTAL_MS = 52_000;
export const READ_CALL_MS = 18_000;
export const READ_TOTAL_MS = 24_000;
export const ANSWER_CALL_MS = 24_000;
/** A paper can have at most this many questions; more than this is not an exam page. */
export const MAX_QUESTIONS = 30;
/** Questions answered per Google call. Learn mode writes much more per question, so its groups are smaller. */
export const groupSize = (style: 'quick' | 'learn') => (style === 'learn' ? 5 : 8);
export const NO_ANSWER = 'No answer came back for this question. Try the photo again.';

/**
 * POST /api/answer: photos in, spoken-style answers out. Only for devices with a valid license.
 * Students pay for the app but use THEIR OWN free Gemini key (header x-gemini-key); it is forwarded to
 * Google for this one request and never stored. The owner's devices use the server's GEMINI_API_KEY.
 */
export async function handleAnswer(req: Request, store: Store): Promise<Response> {
  if (!secret()) return fail('config', 'The server is missing its settings.', 500);

  const auth = await verify(store, secret(), req.headers.get('x-license-token'), req.headers.get('x-device-id'));
  if (!auth.ok) return fail('license', auth.error, auth.status === 401 ? 401 : 403);

  let apiKey: string;
  if (auth.owner) {
    apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) return fail('config', 'The server has no GEMINI_API_KEY set.', 500);
  } else {
    apiKey = (req.headers.get('x-gemini-key') || '').trim();
    if (!KEY_SHAPE.test(apiKey)) return fail('need_key', 'Add your free Gemini key in Settings to read photos.', 400);
  }

  if (Number(req.headers.get('content-length') || 0) > 4_000_000) return fail('size', 'Photo too large. Try fewer or smaller photos.', 413);

  // Short burst limit per license (protects the server; students' own Gemini quota is their own business).
  const burstMax = auth.owner ? 60 : 12;
  if ((await store.hit(`burst:${auth.key}`, 600, 1)) > burstMax) return fail('limit', 'Too many requests. Wait a few minutes.', 429);

  let body: any;
  try { body = await req.json(); } catch { return fail('bad', 'Bad request.', 400); }

  const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return fail('bad', 'No photo received.', 400);

  const style: 'quick' | 'learn' = body.style === 'learn' ? 'learn' : 'quick';
  const started = Date.now();

  const photos: any[] = [];
  for (const img of images) {
    const m = typeof img === 'string' && img.length < 2_500_000 && img.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    if (!m) return fail('bad', "That image can't be used. Try another photo.", 400);
    photos.push({ inline_data: { mime_type: m[1], data: img.slice(m[0].length) } });
  }

  // Step 1: read the photos and list the questions (short output, so it is quick).
  const read = await generate(
    apiKey,
    { contents: [{ parts: [{ text: readPrompt }, ...photos] }], generationConfig: { temperature: 0, maxOutputTokens: 6000, responseMimeType: 'application/json', responseSchema: readSchema } },
    (d) => parseQuestions(replyText(d)),
    { timeoutMs: READ_CALL_MS, deadlineMs: READ_TOTAL_MS, noThinking: true },
  );
  if (!read.ok) {
    const f = describeFailure(read.last, auth.owner);
    return fail(f.code, f.error, f.status, `reading the photo: ${read.last.msg}`);
  }
  const questions = read.value.slice(0, MAX_QUESTIONS);
  if (!questions.length) return fail('empty', 'No questions were found in that photo. Try a clearer, closer shot.', 422);

  // Step 2: answer the questions in small groups, all at once. The model that just worked goes first.
  const size = groupSize(style);
  const groups: (typeof questions)[] = [];
  for (let i = 0; i < questions.length; i += size) groups.push(questions.slice(i, i + size));
  const left = Math.max(10_000, TOTAL_MS - (Date.now() - started));

  const done = await Promise.all(
    groups.map((group) =>
      generate(
        apiKey,
        { contents: [{ parts: [{ text: answerPrompt(style, group) }, ...photos] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4000, responseMimeType: 'application/json', responseSchema: answerSchema } },
        (d) => parseAnswers(replyText(d)),
        { models: [read.model], timeoutMs: ANSWER_CALL_MS, deadlineMs: left, noThinking: true },
      ),
    ),
  );

  const items: { label: string; answer: string }[] = [];
  let missing = 0;
  let lastFail: GeminiFail | undefined;
  for (let g = 0; g < groups.length; g++) {
    const r = done[g];
    if (!r.ok) lastFail = r.last;
    for (let i = 0; i < groups[g].length; i++) {
      const answer = r.ok ? r.value.get(i + 1) : undefined;
      if (!answer) missing++;
      items.push({ label: groups[g][i].label, answer: answer || NO_ANSWER });
    }
  }

  // Nothing answered at all: explain why. Some answered: give those, and mark only the missing ones.
  if (missing === items.length) {
    const why: GeminiFail = lastFail ?? { status: 502, msg: 'the model sent back no usable answers' };
    const f = describeFailure(why, auth.owner);
    return fail(f.code, f.error, f.status, `answering ${questions.length} questions: ${why.msg}`);
  }
  const text = items.map((i) => (i.label ? i.label + '. ' : '') + i.answer).join('\n');
  return json({ items, text, model: read.model, partial: missing });
}
