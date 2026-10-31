import { createLicenses, normKey, type Store } from './license';
import { blocked, clientIp, isAdmin, recordFail } from './http';

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' } });

/** Shared by GET/POST/PATCH/DELETE: password check with brute-force protection. */
async function guard(req: Request, store: Store): Promise<Response | null> {
  const ip = clientIp(req);
  if (await blocked(store, 'badadmin', ip, 8)) return reply({ error: 'Too many wrong passwords. Wait a few minutes.' }, 429);
  if (!isAdmin(req)) {
    await recordFail(store, 'badadmin', ip);
    return reply({ error: 'Wrong password.' }, 401);
  }
  return null;
}

export async function adminGet(req: Request, store: Store) {
  const g = await guard(req, store);
  if (g) return g;
  const licenses = (await store.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return reply({ licenses });
}

// Create: { label, count?, maxDevices? }
export async function adminCreate(req: Request, store: Store) {
  const g = await guard(req, store);
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(parseInt(b.count) || 1, 1), 50);
  const maxDevices = Math.min(Math.max(parseInt(b.maxDevices) || 1, 1), 10);
  const label = String(b.label || '').trim().slice(0, 80);
  return reply({ licenses: await createLicenses(store, label, count, maxDevices) });
}

// Manage: { key, action: 'revoke' | 'restore' | 'reset' | 'rename', label? }
export async function adminPatch(req: Request, store: Store) {
  const g = await guard(req, store);
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const lic = await store.get(normKey(b.key));
  if (!lic) return reply({ error: 'Key not found.' }, 404);
  if (b.action === 'revoke') lic.status = 'revoked';
  else if (b.action === 'restore') lic.status = 'active';
  else if (b.action === 'reset') lic.devices = [];
  else if (b.action === 'rename') lic.label = String(b.label || '').trim().slice(0, 80);
  else return reply({ error: 'Unknown action.' }, 400);
  await store.put(lic);
  return reply({ license: lic });
}

export async function adminDelete(req: Request, store: Store) {
  const g = await guard(req, store);
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const key = normKey(b.key);
  if (!(await store.get(key))) return reply({ error: 'Key not found.' }, 404);
  await store.del(key);
  return reply({ deleted: key });
}
