import { apiBase } from '../lib/config';
import { AskFailure, type AskContext } from '../lib/voice/assistant';
import { GeminiKey } from './gemini-key';
import { LicenseService } from './license-service';

/** Sends a spoken question (as text) to the server and returns the spoken-style answer. */
export async function askQuestion(question: string, ctx: AskContext, signal?: AbortSignal): Promise<string> {
  const base = apiBase();
  if (base === null) throw new AskFailure('This build is missing its server address.');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(await LicenseService.authHeaders()) };
  if (!(await LicenseService.isOwner())) {
    const key = await GeminiKey.get();
    if (!key) throw new AskFailure('Add your Gemini key in Settings to ask questions.', 'key');
    headers['x-gemini-key'] = key;
  }
  let res: Response;
  try {
    res = await fetch(`${base}/api/ask`, { method: 'POST', headers, body: JSON.stringify({ question, context: ctx.context, current: ctx.current }), signal });
  } catch {
    throw new AskFailure("I couldn't reach the internet.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.code === 'license') throw new AskFailure(data.error || 'License not valid.', 'license');
    if (data.code === 'need_key' || data.code === 'student_key') throw new AskFailure(data.error || 'Check your Gemini key.', 'key');
    throw new AskFailure(data.error || "Sorry, I couldn't get an answer.");
  }
  return String(data.answer || '').trim() || (() => { throw new AskFailure("Sorry, I couldn't get an answer."); })();
}
