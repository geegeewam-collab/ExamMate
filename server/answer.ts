import { verify, type Store } from './license';
import { json, secret } from './http';
import { answerPrompt, answerSchema, describeFailure, generate, parseAnswers, parseQuestions, readPrompt, readSchema, replyText, type GeminiFail } from './gemini';

const fail = (code: string, error: string, status: number, detail = '') =>
  json({ code, error, detail: String(detail).slice(0, 240) }, status);

const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,200}$/;

async function readJsonLimited(req: Request): Promise<{ ok: true; value: any } | { ok: false; tooLarge?: boolean; aborted?: boolean }> {
  const reader = req.body?.getReader();
  if (!reader) return { ok: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return req.signal.aborted ? { ok: false, aborted: true } : { ok: false };
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return { ok: true, value: JSON.parse(new TextDecoder().decode(joined)) }; }
  catch { return { ok: false }; }
}

async function mapConcurrent<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Keep the full paper request inside the route's 120 s execution window. Photo reading gets a larger
// first-stage budget; answering keeps the remaining time and retries only incomplete groups. Client-side
// page batching means long papers are processed across requests, with no fixed page or question-count cap.
export const TOTAL_MS = 108_000;
export const READ_CALL_MS = 36_000;
export const READ_TOTAL_MS = 50_000;
export const ANSWER_CALL_MS = 35_000;
/** Maximum serialized payload for one request; client-side batching means this is not a paper/page-count limit. */
export const MAX_REQUEST_BYTES = 4_000_000;
/** Questions answered per Google call. Learn mode writes much more per question, so its groups are smaller. */
export const groupSize = (style: 'quick' | 'learn') => (style === 'learn' ? 5 : 8);

/**
 * POST /api/answer: photos in, spoken-style answers out. Only for devices with a valid license.
 * Students pay for the app but use THEIR OWN free Gemini key (header x-gemini-key); it is forwarded to
 * Google for this one request and never stored. The owner's devices use the server's GEMINI_API_KEY.
 */
export async function handleAnswer(req: Request, store: Store): Promise<Response> {
  if (!secret()) return fail('config', 'The server is missing its settings.', 500);
  if (req.signal.aborted) return fail('aborted', 'Processing was stopped.', 499);

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

  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return fail('size', 'This page batch is too large. The app should split it automatically; try uploading the pages again.', 413);

  // Abuse throttle, not a paper-size limit. Client page batches from one long paper must not hit the old 12-request cap.
  const burstMax = auth.owner ? 120 : 240;
  if ((await store.hit(`burst:${auth.key}`, 600, 1)) > burstMax) return fail('limit', 'Too many requests. Wait a few minutes.', 429);

  const parsed = await readJsonLimited(req);
  if (!parsed.ok) return parsed.aborted || req.signal.aborted
    ? fail('aborted', 'Processing was stopped.', 499)
    : parsed.tooLarge
      ? fail('size', 'This page batch is too large. The app should split it automatically; try uploading the pages again.', 413)
      : fail('bad', 'Bad request.', 400);
  const body = parsed.value;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('bad', 'Bad request.', 400);
  const images: string[] = Array.isArray(body.images) ? body.images : [];
  if (!images.length) return fail('bad', 'No photo received.', 400);
  // This is a per-request memory/payload bound only. The client sends as many batches as needed for a full paper.
  if (images.length > 3) return fail('bad', 'This page batch contains too many images. Please retry so the app can split it safely.', 400);

  const style: 'quick' | 'learn' = body.style === 'learn' ? 'learn' : 'quick';
  const started = Date.now();

  const photos: any[] = [];
  for (const img of images) {
    const m = typeof img === 'string' && img.length <= 3_200_000 && img.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    if (!m) return fail('bad', "That image can't be used. Try another photo.", 400);
    photos.push({ inline_data: { mime_type: m[1], data: img.slice(m[0].length) } });
  }

  // Step 1: read the photos and list the questions (short output, so it is quick).
  const read = await generate(
    apiKey,
    { contents: [{ parts: [{ text: readPrompt }, ...photos] }], generationConfig: { temperature: 0, maxOutputTokens: 16000, responseMimeType: 'application/json', responseSchema: readSchema } },
    (d) => parseQuestions(replyText(d)),
    { timeoutMs: READ_CALL_MS, deadlineMs: READ_TOTAL_MS, noThinking: true, signal: req.signal },
  );
  if (req.signal.aborted) return fail('aborted', 'Processing was stopped.', 499);
  if (!read.ok) {
    const f = describeFailure(read.last, auth.owner);
    return fail(f.code, f.error, f.status, `reading the photo: ${read.last.msg}`);
  }
  const questions = read.value;
  // A batch may contain only a cover page or exam instructions. Treat it as a completed
  // page batch so the client can continue with later pages; the client reports an empty
  // overall paper only after every uploaded batch has been processed.
  if (!questions.length) return json({ items: [], text: '', model: read.model, partial: 0, questionCount: 0 });

  // Step 2: answer the questions in small groups, all at once. The model that just worked goes first.
  const size = groupSize(style);
  const groups: (typeof questions)[] = [];
  for (let i = 0; i < questions.length; i += size) groups.push(questions.slice(i, i + size));

  // Keep provider concurrency bounded: it protects low-tier keys from burst throttling while
  // still answering independent groups concurrently. There is no question-count cutoff.
  const answerOneGroup = (group: typeof questions) => {
    const remaining = Math.max(1_500, TOTAL_MS - (Date.now() - started));
    if (req.signal.aborted) return Promise.resolve({ ok: false as const, last: { status: 499, msg: 'client cancelled the request' }, trace: [] });
    return generate(
      apiKey,
      { contents: [{ parts: [{ text: answerPrompt(style, group) }, ...photos] }], generationConfig: { temperature: 0.2, maxOutputTokens: 16000, responseMimeType: 'application/json', responseSchema: answerSchema } },
      (d) => parseAnswers(replyText(d)),
      { models: [read.model], timeoutMs: ANSWER_CALL_MS, deadlineMs: remaining, noThinking: true, signal: req.signal },
    );
  };

  const firstPass = await mapConcurrent(groups, 3, answerOneGroup);
  // A group is complete only when every numbered answer came back. Retry just incomplete groups once.
  const incomplete = firstPass.flatMap((result, index) => {
    const complete = result.ok && groups[index].every((_, questionIndex) => Boolean(result.value.get(questionIndex + 1)));
    return complete ? [] : [index];
  });
  const retryResults = await mapConcurrent(incomplete, 2, (index) => answerOneGroup(groups[index]));
  const finalResults = firstPass.slice();
  incomplete.forEach((groupIndex, retryIndex) => { finalResults[groupIndex] = retryResults[retryIndex]; });

  if (req.signal.aborted) return fail('aborted', 'Processing was stopped.', 499);
  const items: { label: string; answer: string }[] = [];
  for (let g = 0; g < groups.length; g++) {
    const result = finalResults[g];
    if (!result.ok || !groups[g].every((_, index) => Boolean(result.value.get(index + 1)))) {
      const why: GeminiFail = result.ok ? { status: 502, msg: `the model did not return every answer in group ${g + 1}` } : result.last;
      const f = describeFailure(why, auth.owner);
      return fail(f.code, 'ExamMate could not complete every answer in this paper. Please try again.', f.status, `answering ${questions.length} questions: ${why.msg}`);
    }
    for (let i = 0; i < groups[g].length; i++) {
      items.push({ label: groups[g][i].label, answer: result.value.get(i + 1)! });
    }
  }
  // One line per point. A one-line answer stays on its question's line ("Section A, Question 1. ..."); a list gets the
  // question label on its own line, then each point on its own line, so "THREE things" is read and shown as three things.
  const text = items
    .flatMap((i) => {
      const lines = i.answer.split('\n');
      if (lines.length === 1) return [(i.label ? i.label + '. ' : '') + lines[0]];
      return i.label ? [i.label + '.', ...lines] : lines;
    })
    .join('\n');
  return json({ items, text, model: read.model, partial: 0, questionCount: questions.length });
}
