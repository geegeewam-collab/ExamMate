import { activate, normKey, signToken, transfer, transferAvailability, validDevice, verify, type Store } from './license';
import { blocked, clientIp, json, recordFail, secret } from './http';
import { authenticateParentPassword, getAdminState } from './admin-auth';

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
  if (r.inUse) {
    // The key is on another phone: tell the app whether the student can move it here themselves.
    const lic = await store.get(normKey(body.licenseKey));
    const availability = lic ? transferAvailability(lic) : { canTransfer: false };
    return json({ code: 'in_use', error: r.error, ...availability }, r.status);
  }
  return json({ error: r.error }, r.status);
}

/** POST /api/license/transfer  { licenseKey, deviceId }  ->  { token }. Moves the key to this phone (once per 30 days). */
export async function handleTransfer(req: Request, store: Store): Promise<Response> {
  if (!secret()) return json({ error: 'The server is missing its settings.' }, 500);
  const ip = clientIp(req);
  if (await blocked(store, 'badkey', ip, 15)) {
    return json({ error: 'Too many wrong keys. Wait a few minutes and try again.' }, 429);
  }
  const body = await req.json().catch(() => ({}));
  const r = await transfer(store, secret(), body?.licenseKey, body?.deviceId);
  if (r.ok) return json({ token: r.token, owner: false });
  if (r.status === 404) await recordFail(store, 'badkey', ip);
  return json({ error: r.error, ...(r.retryAt ? { code: 'cooldown', retryAt: r.retryAt } : {}) }, r.status);
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
  if (!validDevice(body?.deviceId)) return json({ error: 'Missing device.' }, 400);
  const configured = await getAdminState(store);
  if (!configured) return json({ error: 'The server has no configured parent admin password.' }, 500);
  const state = await authenticateParentPassword(store, body?.password);
  if (!state) {
    await recordFail(store, 'badowner', ip);
    return json({ error: 'Wrong password.' }, 401);
  }
  const token = signToken('OWNER', body.deviceId, secret(), { v: state.ownerTokenVersion });
  return json({ token, owner: true });
}
