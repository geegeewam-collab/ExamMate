import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODELS = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"].filter(
  (m, i, a): m is string => !!m && a.indexOf(m) === i
);

const prompt = (style: string) => `The attached images are photos of a page of questions, in order. Answer every question you can read.
Your answer will be read aloud by a text-to-speech voice and written down by hand, so:
- Plain text only: no markdown, asterisks, hashes, tables or LaTeX.
- One paragraph per question, starting with its number as shown in the photo, like "Question 1." or "Question 2 b."
- ${style === "work" ? "Give the answer, then the working or reason in 1 to 3 short sentences." : "Give just the answer, as briefly as the question allows. For calculations give the final result only."}
- Write maths and symbols as words, for example "x squared plus 3" or "five over eight".
- For multiple choice, say the letter and then the option text.
- If something is unreadable or missing, say so in one short sentence for that question.
- No introduction, commentary or closing line.`;

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const pass = process.env.READER_PASSCODE;
  const key = process.env.GEMINI_API_KEY;
  if (!pass || !key) return fail("Server is not configured.", 500);
  if (!same(req.headers.get("x-passcode") || "", pass)) return fail("Wrong passcode.", 401);

  let body: any;
  try { body = await req.json(); } catch { return fail("Bad request.", 400); }

  const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return fail("No photo received.", 400);

  const parts: any[] = [{ text: prompt(body.style === "work" ? "work" : "short") }];
  for (const img of images) {
    const m = typeof img === "string" && img.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    if (!m) return fail("Unsupported image.", 400);
    parts.push({ inline_data: { mime_type: m[1], data: img.slice(m[0].length) } });
  }

  let status = 502, msg = "";
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2 } }),
    });
    if (r.ok) {
      const d = await r.json();
      const text = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || "").join("").trim();
      if (text) return NextResponse.json({ text, model });
      status = 502; msg = "No answer came back. Try a clearer photo.";
      continue;
    }
    const e = await r.json().catch(() => null);
    status = r.status; msg = e?.error?.message || r.statusText;
    console.error("Gemini error", model, status, msg);
    if (status === 400 || status === 401 || status === 403) break;
  }
  return fail(`Gemini said (${status}): ${msg}`.slice(0, 300), status === 429 ? 429 : 502);
}
