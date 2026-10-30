import { verify, type Store } from './license';
import { json, secret } from './http';
import { describeFailure, generate } from './gemini';

const fail = (code: string, error: string, status: number, detail = '', extra: Record<string, unknown> = {}) =>
  json({ code, error, detail: String(detail).slice(0, 240), ...extra }, status);

const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,200}$/;

// A spoken answer has to be quick. Gemini normally replies in about a second, so a call that is silent after 5 s is stuck:
// give up on it and try the next model. The whole question gets 9 s (the app waits 11 s).
export const ASK_CALL_MS = 5_000;
export const ASK_TOTAL_MS = 9_000;

export const ACTIONS = ['none', 'repeat', 'next', 'back', 'pause', 'resume', 'stop', 'slower', 'faster'] as const;
export type Action = (typeof ACTIONS)[number];

const PROMPT = `You are Exam Mate's voice helper. A student is listening to exam answers being read aloud, slowly, so they can write them down. They have just spoken to you.

Work out what they want, however they word it:
1. They want the READER to do something. Pick one action:
   repeat (say the current phrase again, e.g. "I missed that", "what was that", "say it once more"),
   next (move ahead, e.g. "skip this", "I've got that, go on to the next bit"),
   back (go to the previous phrase, e.g. "go to the one before"),
   pause (stop for now, e.g. "hold on a sec", "wait"),
   resume (carry on reading, e.g. "ok go ahead", "continue"),
   stop (end the reading session),
   slower (e.g. "that's too quick", "can you ease up"),
   faster (e.g. "could you try going faster", "speed it up a bit").
   For an action, "answer" is a confirmation of at most four words, such as "Going faster." or "Okay."
2. Anything else is a question or a request for help. Use action "none" and write the reply in "answer": one to three short, clear sentences, as you would say them aloud. Plain words only: no markdown, no lists, no symbols. Say maths in words, for example "x squared plus 3". Use the answers being read as context when the question is about them. If you could not understand them, say so in one short sentence and ask them to say it again.

Reply with JSON only: {"action": "...", "answer": "..."}`;

const SCHEMA = {
  type: 'OBJECT',
  properties: { action: { type: 'STRING', enum: [...ACTIONS] }, answer: { type: 'STRING' } },
  required: ['action', 'answer'],
};

/** Keeps spoken text clean: no markdown characters, one line, not too long. */
export const cleanSpoken = (t: string) => t.replace(/[*_#`>~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 700);

/** Reads the model's JSON. Unknown actions become "none". Returns null if there is nothing usable. */
export function parseIntent(raw: string): { action: Action; answer: string } | null {
  try {
    const j = JSON.parse(raw);
    const action: Action = (ACTIONS as readonly string[]).includes(j?.action) ? j.action : 'none';
    const answer = cleanSpoken(String(j?.answer ?? ''));
    if (action === 'none' && !answer) return null;
    return { action, answer };
  } catch {
    return null;
  }
}

/** Fast models first (no lookup). Override with GEMINI_ASK_MODEL. Lite models answer quickly and have the most generous free limits. */
const fastModels = () => [process.env.GEMINI_ASK_MODEL, 'gemini-flash-lite-latest', 'gemini-flash-latest'].filter((m): m is string => !!m);

/**
 * POST /api/ask  { question, context?, current? }  ->  { action, answer }
 * One AI call decides whether the student wants the reader controlled (action) or a question answered (answer).
 * Same rules as /api/answer: needs a valid license; students bring their own Gemini key, the owner uses the server's.
 * { warm: true } only wakes the server up and checks the license (the app sends it while the student is still speaking).
 */
export async function handleAsk(req: Request, store: Store): Promise<Response> {
  const t0 = Date.now();
  if (!secret()) return fail('config', 'The server is missing its settings.', 500);

  const tVerify = Date.now();
  const auth = await verify(store, secret(), req.headers.get('x-license-token'), req.headers.get('x-device-id'));
  const verifyMs = Date.now() - tVerify;
  if (!auth.ok) return fail('license', auth.error, auth.status === 401 ? 401 : 403);

  let body: any;
  try { body = await req.json(); } catch { return fail('bad', 'Bad request.', 400); }
  if (body?.warm) return json({ ok: true });

  let apiKey: string;
  if (auth.owner) {
    apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) return fail('config', 'The server has no GEMINI_API_KEY set.', 500);
  } else {
    apiKey = (req.headers.get('x-gemini-key') || '').trim();
    if (!KEY_SHAPE.test(apiKey)) return fail('need_key', 'Add your free Gemini key in Settings to ask questions.', 400);
  }

  const tLimit = Date.now();
  const used = await store.hit(`ask:${auth.key}`, 600, 1);
  const limitMs = Date.now() - tLimit;
  if (used > (auth.owner ? 120 : 40)) return fail('limit', 'Too many questions. Wait a few minutes.', 429);

  const question = String(body?.question ?? '').trim().slice(0, 400);
  if (question.length < 2) return fail('bad', 'No question received.', 400);
  const context = String(body?.context ?? '').slice(0, 4000);
  const current = String(body?.current ?? '').slice(0, 400);

  const text =
    `${PROMPT}\n\nAnswers being read to the student:\n${context || '(none)'}\n\n` +
    `The phrase being read right now: ${current || '(none)'}\n\nThe student said: ${question}`;

  const tAi = Date.now();
  const out = await generate(
    apiKey,
    { contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 800, responseMimeType: 'application/json', responseSchema: SCHEMA } },
    (d) => parseIntent((d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || '').join('').trim()),
    { models: fastModels(), timeoutMs: ASK_CALL_MS, deadlineMs: ASK_TOTAL_MS, noThinking: true },
  );
  const aiMs = Date.now() - tAi;
  // Where the time went on the server, for the owner's timing panel (verify = licence check, limit = rate-limit counter, ai = Gemini).
  const timing = { verifyMs, limitMs, aiMs, totalMs: Date.now() - t0, tries: out.trace };
  if (out.ok) return json({ action: out.value.action, answer: out.value.answer, model: out.model, ms: timing.totalMs, timing });
  const f = describeFailure(out.last, auth.owner);
  return fail(f.code, f.error.replace('The photo could not be processed. Try again, or try a clearer photo.', 'I could not get an answer. Try again.'), f.status, out.last.msg, { timing });
}
