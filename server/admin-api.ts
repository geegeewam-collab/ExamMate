import { createLicenses, normKey, type Store } from './license';
import { blocked, clientIp, recordFail } from './http';
import { authenticateAdmin } from './admin-auth';

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' } });

/** Admin routes accept short-lived signed sessions, never a password on every request. Guests are strictly read-only. */
async function guard(req: Request, store: Store, write = false): Promise<Response | null> {
  const ip = clientIp(req);
  if (await blocked(store, 'badadmin', ip, 20)) return reply({ error: 'Too many admin requests. Try again later.' }, 429);
  const session = await authenticateAdmin(req, store);
  if (!session) {
    await recordFail(store, 'badadmin', ip);
    return reply({ error: 'Your admin session expired. Sign in again.' }, 401);
  }
  if (write && session.role !== 'parent') return reply({ error: 'Guest access is read-only. Ask the parent admin to make this change.' }, 403);
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
  const g = await guard(req, store, true);
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(parseInt(b.count) || 1, 1), 50);
  const maxDevices = Math.min(Math.max(parseInt(b.maxDevices) || 1, 1), 10);
  const label = String(b.label || '').trim().slice(0, 80);
  return reply({ licenses: await createLicenses(store, label, count, maxDevices) });
}

// Manage: { key, action: 'revoke' | 'restore' | 'reset' | 'rename', label? }
export async function adminPatch(req: Request, store: Store) {
  const g = await guard(req, store, true);
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
  const g = await guard(req, store, true);
  if (g) return g;
  const b = await req.json().catch(() => ({}));
  const key = normKey(b.key);
  if (!(await store.get(key))) return reply({ error: 'Key not found.' }, 404);
  await store.del(key);
  return reply({ deleted: key });
}
