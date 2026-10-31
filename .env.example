import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const API = "https://generativelanguage.googleapis.com/v1beta";

// Best-effort limits (memory is per server instance, so this slows abuse but is not airtight).
const hits = new Map<string, number[]>();
const limited = (id: string, max: number, ms: number) => {
  const now = Date.now();
  const a = (hits.get(id) ?? []).filter((t) => now - t < ms);
  a.push(now);
  hits.set(id, a);
  return a.length > max;
};

// Ask Google which Flash models this key can use, newest first, instead of guessing names.
let cache: { at: number; names: string[] } | null = null;
async function models(key: string): Promise<string[]> {
  if (!cache || Date.now() - cache.at > 3_600_000) {
    let names: string[] = [];
    try {
      const r = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
      if (r.ok) {
        const d = await r.json();
        names = (d.models ?? [])
          .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
          .map((m: any) => String(m.name).replace("models/", ""))
          .filter((n: string) => n.startsWith("gemini-") && n.includes("flash") && !/tts|image|live|audio|embedding|robotics|computer/.test(n));
      }
    } catch {}
    const v = (n: string) => parseFloat(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
    const score = (n: string) => v(n) * 10 - (n.includes("lite") ? 1 : 0) - (/preview|exp/.test(n) ? 0.5 : 0);
    names.sort((a, b) => score(b) - score(a));
    if (names.length) cache = { at: Date.now(), names };
    else return ["gemini-flash-latest", "gemini-2.5-flash"];
  }
  const pinned = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [];
  return [...pinned, ...cache.names, "gemini-flash-latest"].filter((m, i, a) => a.indexOf(m) === i).slice(0, 5);
}

const prompt = (mode: string) => `The attached images are photos of a page of questions, in order. Answer every question you can read.
Your answers will be read aloud by a text-to-speech voice and written down by hand, so:
- Plain text only: no markdown, asterisks, hashes, tables or LaTeX. Never use line breaks inside an answer.
- label: the question number as shown in the photo, like "Question 1" or "Question 2 b".
- answer: ${mode === "learn" ? "the answer, then the method in a few short steps, then one short worked example. Keep it clear and easy to follow when spoken." : "just the answer, as briefly as the question allows. For calculations give the final result only."}
- Write maths and symbols as words, for example "x squared plus 3" or "five over eight".
- For multiple choice, say the letter and then the option text.
- If a question is unreadable or something is missing, say so in one short sentence as its answer.
- Do not add extra questions, an introduction or commentary.`;

const schema = {
  type: "OBJECT",
  properties: { questions: { type: "ARRAY", items: { type: "OBJECT", properties: { label: { type: "STRING" }, answer: { type: "STRING" } }, required: ["label", "answer"] } } },
  required: ["questions"],
};

function parse(raw: string): { label: string; answer: string }[] {
  try {
    const q = JSON.parse(raw).questions;
    return (Array.isArray(q) ? q : [])
      .map((x: any) => ({ label: String(x.label ?? "").replace(/[.\s]+$/, "").trim(), answer: String(x.answer ?? "").replace(/\s+/g, " ").trim() }))
      .filter((x) => x.answer);
  } catch {
    return [];
  }
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (code: string, error: string, status: number, detail = "") =>
  NextResponse.json({ code, error, detail: detail.slice(0, 240) }, { status });

export async function POST(req: NextRequest) {
  const pass = process.env.READER_PASSCODE;
  const key = process.env.GEMINI_API_KEY;
  if (!pass || !key) return fail("config", "The server is missing its settings.", 500);

  const ip = (req.headers.get("x-forwarded-for") || "x").split(",")[0].trim();
  if (!same(req.headers.get("x-passcode") || "", pass)) {
    return limited("bad:" + ip, 8, 600_000)
      ? fail("locked", "Too many wrong passcodes. Wait a few minutes.", 429)
      : fail("passcode", "Wrong passcode.", 401);
  }
  if (limited("req:" + ip, 20, 600_000)) return fail("limit", "Too many requests. Wait a few minutes.", 429);
  if (Number(req.headers.get("content-length") || 0) > 4_000_000) return fail("size", "Photo too large. Try fewer or smaller photos.", 413);

  let body: any;
  try { body = await req.json(); } catch { return fail("bad", "Bad request.", 400); }

  const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return fail("bad", "No photo received.", 400);

  const parts: any[] = [{ text: prompt(body.style === "learn" ? "learn" : "quick") }];
  for (const img of images) {
    const m = typeof img === "string" && img.length < 2_500_000 && img.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    if (!m) return fail("bad", "That image can't be used. Try another photo.", 400);
    parts.push({ inline_data: { mime_type: m[1], data: img.slice(m[0].length) } });
  }

  let last = { status: 502, msg: "" };
  for (const model of await models(key)) {
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema } }),
    });
    if (r.ok) {
      const d = await r.json();
      const raw = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || "").join("").trim();
      const items = parse(raw);
      if (items.length) {
        const text = items.map((i) => (i.label ? i.label + ". " : "") + i.answer).join("\n");
        return NextResponse.json({ items, text, model });
      }
      last = { status: 502, msg: "empty answer from " + model };
      continue;
    }
    const e = await r.json().catch(() => null);
    last = { status: r.status, msg: `${model}: ${e?.error?.message || r.statusText}` };
    console.error("Gemini error", last.status, last.msg);
    if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(last.msg))) break;
  }

  const m = last.msg.toLowerCase();
  if (last.status === 401 || last.status === 403 || /api key/.test(m)) return fail("bad_key", "The AI key was rejected. Check GEMINI_API_KEY in Vercel.", 502, last.msg);
  if (last.status === 429) return fail("rate_limited", "The free limit was reached. Wait a minute and try again.", 429, last.msg);
  if (last.status === 404 || /no longer available|not found/.test(m)) return fail("no_model", "No AI model is available for this key right now.", 502, last.msg);
  return fail("failed", "The photo could not be processed. Try again, or try a clearer photo.", 502, last.msg);
}
