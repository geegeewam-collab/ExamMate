import { verify, type Store } from './license';
import { json, secret } from './http';
import { API, models, parse, prompt, schema } from './gemini';

const fail = (code: string, error: string, status: number, detail = '') =>
  json({ code, error, detail: String(detail).slice(0, 240) }, status);

const today = () => new Date().toISOString().slice(0, 10);

/** POST /api/answer: photos in, spoken-style answers out. Only for devices with a valid license. */
export async function handleAnswer(req: Request, store: Store): Promise<Response> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!secret() || !geminiKey) return fail('config', 'The server is missing its settings.', 500);

  const auth = await verify(store, secret(), req.headers.get('x-license-token'), req.headers.get('x-device-id'));
  if (!auth.ok) return fail('license', auth.error, auth.status === 401 ? 401 : 403);

  if (Number(req.headers.get('content-length') || 0) > 4_000_000) return fail('size', 'Photo too large. Try fewer or smaller photos.', 413);

  // Per-license limits protect your Gemini bill: a short burst limit and a daily cap.
  const dailyMax = Math.max(1, parseInt(process.env.DAILY_LIMIT || '60') || 60);
  if ((await store.hit(`burst:${auth.key}`, 600, 1)) > 12) return fail('limit', 'Too many requests. Wait a few minutes.', 429);
  const dayKey = `day:${auth.key}:${today()}`;
  const used = await store.hit(dayKey, 172_800, 1);
  const refund = () => store.hit(dayKey, 172_800, -1).catch(() => 0);
  if (used > dailyMax) {
    await refund();
    return fail('quota', `Daily limit of ${dailyMax} photos reached. Try again tomorrow.`, 429);
  }

  let body: any;
  try { body = await req.json(); } catch { await refund(); return fail('bad', 'Bad request.', 400); }

  const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) { await refund(); return fail('bad', 'No photo received.', 400); }

  const parts: any[] = [{ text: prompt(body.style === 'learn' ? 'learn' : 'quick') }];
  for (const img of images) {
    const m = typeof img === 'string' && img.length < 2_500_000 && img.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    if (!m) { await refund(); return fail('bad', "That image can't be used. Try another photo.", 400); }
    parts.push({ inline_data: { mime_type: m[1], data: img.slice(m[0].length) } });
  }

  let last = { status: 502, msg: '' };
  for (const model of await models(geminiKey)) {
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } }),
    });
    if (r.ok) {
      const d = await r.json();
      const raw = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || '').join('').trim();
      const items = parse(raw);
      if (items.length) {
        const text = items.map((i) => (i.label ? i.label + '. ' : '') + i.answer).join('\n');
        return json({ items, text, model });
      }
      last = { status: 502, msg: 'empty answer from ' + model };
      continue;
    }
    const e = await r.json().catch(() => null);
    last = { status: r.status, msg: `${model}: ${e?.error?.message || r.statusText}` };
    console.error('Gemini error', last.status, last.msg);
    if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(last.msg))) break;
  }

  await refund(); // a failed photo should not use up the student's daily allowance
  const m = last.msg.toLowerCase();
  if (last.status === 401 || last.status === 403 || /api key/.test(m)) return fail('bad_key', 'The AI service is unavailable right now. Please tell your provider.', 502, last.msg);
  if (last.status === 429) return fail('rate_limited', 'The AI service is busy. Wait a minute and try again.', 429, last.msg);
  if (last.status === 404 || /no longer available|not found/.test(m)) return fail('no_model', 'No AI model is available right now. Try again later.', 502, last.msg);
  return fail('failed', 'The photo could not be processed. Try again, or try a clearer photo.', 502, last.msg);
}
