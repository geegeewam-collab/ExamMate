import { activate, verify, type Store } from './license';
import { blocked, clientIp, json, recordFail, secret } from './http';

export async function handleValidate(req: Request, store: Store): Promise<Response> {
  if (!secret()) return json({ error: 'The server is missing its settings.' }, 500);
  const ip = clientIp(req);
  if (await blocked(store, 'badkey', ip, 15)) {
    return json({ error: 'Too many wrong keys. Wait a few minutes and try again.' }, 429);
  }
  const body = await req.json().catch(() => ({}));
  const r = await activate(store, secret(), body.licenseKey, body.deviceId);
  if (r.ok) return json({ token: r.token });
  if (r.status === 404) await recordFail(store, 'badkey', ip);
  return json({ error: r.error }, r.status);
}

export async function handleVerify(req: Request, store: Store): Promise<Response> {
  if (!secret()) return json({ error: 'The server is missing its settings.' }, 500);
  const body = await req.json().catch(() => ({}));
  const r = await verify(store, secret(), body.token, body.deviceId);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
