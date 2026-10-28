import { apiBase } from '../lib/config';
import { AskFailure, type AskContext, type AskResult } from '../lib/voice/assistant';
import { GeminiKey } from './gemini-key';
import { LicenseService } from './license-service';

const ACTIONS = ['none', 'repeat', 'next', 'back', 'pause', 'resume', 'stop', 'slower', 'faster'];

/** Sends what the student said (as text) to the server. The AI replies with an instruction for the reader or a spoken answer. */
export async function askQuestion(question: string, ctx: AskContext, signal?: AbortSignal): Promise<AskResult> {
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
  const action = ACTIONS.includes(data.action) ? data.action : 'none';
  const answer = String(data.answer || '').trim();
  if (action === 'none' && !answer) throw new AskFailure("Sorry, I couldn't get an answer.");
  return { action, answer, ms: typeof data.ms === 'number' ? data.ms : undefined };
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
