import { verify, type Store } from './license';
import { json, secret } from './http';
import { describeFailure, generate, parse, prompt, schema } from './gemini';

const fail = (code: string, error: string, status: number, detail = '') =>
  json({ code, error, detail: String(detail).slice(0, 240) }, status);

const KEY_SHAPE = /^[A-Za-z0-9_\-]{20,200}$/;

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

  const parts: any[] = [{ text: prompt(body.style === 'learn' ? 'learn' : 'quick') }];
  for (const img of images) {
    const m = typeof img === 'string' && img.length < 2_500_000 && img.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    if (!m) return fail('bad', "That image can't be used. Try another photo.", 400);
    parts.push({ inline_data: { mime_type: m[1], data: img.slice(m[0].length) } });
  }

  const out = await generate(
    apiKey,
    { contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } },
    (d) => {
      const raw = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || '').join('').trim();
      const items = parse(raw);
      return items.length ? items : null;
    },
    { timeoutMs: 40_000, deadlineMs: 52_000 },
  );
  if (out.ok) {
    const text = out.value.map((i) => (i.label ? i.label + '. ' : '') + i.answer).join('\n');
    return json({ items: out.value, text, model: out.model });
  }
  const f = describeFailure(out.last, auth.owner);
  return fail(f.code, f.error, f.status, out.last.msg);
}
