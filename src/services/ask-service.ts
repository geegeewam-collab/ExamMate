import { apiBase } from '../lib/config';
import { AskFailure, type AskContext, type AskResult } from '../lib/voice/assistant';
import { GeminiKey } from './gemini-key';
import { LicenseService } from './license-service';

const ACTIONS = ['none', 'repeat', 'next', 'back', 'pause', 'resume', 'stop', 'slower', 'faster'];

/** Sends what the student said (as text) to the server. The AI replies with an instruction for the reader or a spoken answer. */
export async function askQuestion(question: string, ctx: AskContext, signal?: AbortSignal): Promise<AskResult> {
  const tStart = Date.now();
  const base = apiBase();
  if (base === null) throw new AskFailure('This build is missing its server address.');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(await LicenseService.authHeaders()) };
  if (!(await LicenseService.isOwner())) {
    const key = await GeminiKey.get();
    if (!key) throw new AskFailure('Add your Gemini key in Settings to ask questions.', 'key');
    headers['x-gemini-key'] = key;
  }
  let res: Response;
  const tSend = Date.now();
  const prepMs = tSend - tStart; // licence header, device id and key lookups happen before anything is sent
  try {
    res = await fetch(`${base}/api/ask`, { method: 'POST', headers, body: JSON.stringify({ question, context: ctx.context, current: ctx.current, conversation: ctx.conversation ?? [] }), signal });
  } catch {
    throw new AskFailure("I couldn't reach the internet.", 'other', { timing: { prepMs, roundTripMs: Date.now() - tSend } });
  }
  const data = await res.json().catch(() => ({}));
  const roundTripMs = Date.now() - tSend;
  if (!res.ok) {
    // Keep user-facing failures concise; provider diagnostics stay in server logs, not on a student's screen.
    const extra = { timing: { prepMs, roundTripMs } };
    if (data.code === 'license') throw new AskFailure(data.error || 'License not valid.', 'license', extra);
    if (data.code === 'need_key' || data.code === 'student_key') throw new AskFailure(data.error || 'Check your Gemini key.', 'key', extra);
    throw new AskFailure(data.error || "Sorry, I couldn't get an answer.", 'other', extra);
  }
  const action = ACTIONS.includes(data.action) ? data.action : 'none';
  const answer = String(data.answer || '').trim();
  if (action === 'none' && !answer) throw new AskFailure("Sorry, I couldn't get an answer.");
  return { action, answer, timing: { prepMs, roundTripMs } };
}

/** Wakes the server up (cold start, database connection) while the student is still speaking. Never throws. */
export async function warmServer(): Promise<void> {
  try {
    const base = apiBase();
    if (base === null) return;
    const auth = await LicenseService.authHeaders();
    if (!auth['x-license-token']) return;
    await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: '{"warm":true}', keepalive: true });
  } catch {
    /* warming is only an optimisation */
  }
}
