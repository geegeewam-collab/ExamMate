import { activate, activateOwner, verify, type Store } from './license';
import { blocked, clientIp, json, recordFail, samePassword, secret } from './http';

export async function handleValidate(req: Request, store: Store): Promise<Response> {
  if (!secret()) return json({ error: 'The server is missing its settings.' }, 500);
  const ip = clientIp(req);
  if (await blocked(store, 'badkey', ip, 15)) {
    return json({ error: 'Too many wrong keys. Wait a few minutes and try again.' }, 429);
  }
  const body = await req.json().catch(() => ({}));
  const r = await activate(store, secret(), body.licenseKey, body.deviceId);
  if (r.ok) return json({ token: r.token, owner: false });
  if (r.status === 404) await recordFail(store, 'badkey', ip);
  return json({ error: r.error }, r.status);
}

export async function handleVerify(req: Request, store: Store): Promise<Response> {
  if (!secret()) return json({ error: 'The server is missing its settings.' }, 500);
  const body = await req.json().catch(() => ({}));
  const r = await verify(store, secret(), body.token, body.deviceId);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}

/** POST /api/license/owner  { password, deviceId }  ->  { token, owner: true } */
export async function handleOwner(req: Request, store: Store): Promise<Response> {
  if (!secret()) return json({ error: 'The server is missing its settings.' }, 500);
  const ip = clientIp(req);
  if (await blocked(store, 'badowner', ip, 8)) return json({ error: 'Too many wrong passwords. Wait a few minutes.' }, 429);
  const body = await req.json().catch(() => ({}));
  const r = activateOwner(secret(), process.env.ADMIN_PASSWORD || '', body.password, body.deviceId, samePassword);
  if (r.ok) return json({ token: r.token, owner: true });
  if (r.status === 401) await recordFail(store, 'badowner', ip);
  return json({ error: r.error }, r.status);
}
