import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AdminAuthState, AdminGuest, Store } from './license';
import { ownerVersion, signToken } from './license';
import { blocked, clientIp, json, recordFail, secret } from './http';

const scrypt = promisify(scryptCallback);
const SESSION_MS = 12 * 60 * 60 * 1000;
const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const validDevice = (value: unknown): value is string => typeof value === 'string' && value.length >= 8 && value.length <= 200;
const normalUsername = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);

export interface AdminSession { role: 'parent' | 'guest'; id: string; deviceId: string; version: number; expiresAt: number }

async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), 64) as Buffer;
  return derived.toString('hex');
}

function equalHex(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
  } catch { return false; }
}

/** The first deployment's ADMIN_PASSWORD becomes a salted, persisted password record on first admin sign-in. */
export async function getAdminState(store: Store): Promise<AdminAuthState | null> {
  if (!store.getAdminAuthState || !store.putAdminAuthState) return null;
  const found = await store.getAdminAuthState();
  if (found) return found;
  const bootstrap = process.env.ADMIN_PASSWORD || '';
  if (!bootstrap || !secret()) return null;
  const salt = randomBytes(16).toString('base64url');
  const state: AdminAuthState = {
    salt,
    passwordHash: await hashPassword(bootstrap, salt),
    sessionVersion: 1,
    parentDeviceId: null,
    ownerTokenVersion: ownerVersion(secret(), bootstrap),
    guests: [],
  };
  await store.putAdminAuthState(state);
  return state;
}

function signSession(session: AdminSession): string {
  const body = b64(JSON.stringify(session));
  const signature = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64(signature)}`;
}

function decodeSession(token: string): AdminSession | null {
  if (!secret()) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if ((value.role !== 'parent' && value.role !== 'guest') || typeof value.id !== 'string' || typeof value.deviceId !== 'string' || !Number.isInteger(value.version) || !Number.isFinite(value.expiresAt)) return null;
    return value as AdminSession;
  } catch { return null; }
}

function issue(state: AdminAuthState, role: AdminSession['role'], id: string, deviceId: string): string {
  return signSession({ role, id, deviceId, version: state.sessionVersion, expiresAt: Date.now() + SESSION_MS });
}

export async function authenticateAdmin(req: Request, store: Store): Promise<AdminSession | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const suppliedDevice = req.headers.get('x-admin-device') || '';
  if (!token || !validDevice(suppliedDevice)) return null;
  const session = decodeSession(token);
  if (!session || session.deviceId !== suppliedDevice || session.expiresAt <= Date.now()) return null;
  const state = await getAdminState(store);
  if (!state || session.version !== state.sessionVersion) return null;
  if (session.role === 'parent') {
    if (session.id !== 'parent' || state.parentDeviceId !== suppliedDevice) return null;
  } else if (session.id.startsWith('guest:')) {
    const guest = state.guests.find((g) => g.id === session.id.slice(6) && g.active);
    if (!guest) return null;
  } else if (session.id !== `secondary:${suppliedDevice}`) return null;
  return session;
}

export async function handleAdminLogin(req: Request, store: Store): Promise<Response> {
  const ip = clientIp(req);
  if (await blocked(store, 'badadminlogin', ip, 8)) return json({ error: 'Too many sign-in attempts. Try again later.' }, 429);
  const body = await req.json().catch(() => ({}));
  const deviceId = body?.deviceId;
  if (!validDevice(deviceId)) return json({ error: 'This device could not be identified. Refresh and try again.' }, 400);
  const state = await getAdminState(store);
  if (!state) return json({ error: 'Admin sign-in is not configured on the server.' }, 503);
  const password = typeof body?.password === 'string' ? body.password : '';
  const rawUsername = typeof body?.username === 'string' ? body.username.trim() : '';
  const username = normalUsername(rawUsername);
  if (rawUsername && !username) return json({ error: 'Enter a valid guest username.' }, 400);
  if (password.length > 128) return json({ error: 'Password is too long.' }, 400);

  if (username) {
    const guest = state.guests.find((g) => g.username === username && g.active);
    if (!guest || !equalHex(await hashPassword(password, guest.salt), guest.passwordHash)) {
      await recordFail(store, 'badadminlogin', ip);
      return json({ error: 'Incorrect guest username or password.' }, 401);
    }
    return json({ token: issue(state, 'guest', `guest:${guest.id}`, deviceId), role: 'guest', label: guest.label });
  }

  if (!equalHex(await hashPassword(password, state.salt), state.passwordHash)) {
    await recordFail(store, 'badadminlogin', ip);
    return json({ error: 'Incorrect admin password.' }, 401);
  }
  // The first device is the parent device. Password sign-ins from other devices are deliberately read-only.
  if (!state.parentDeviceId) {
    state.parentDeviceId = deviceId;
    await store.putAdminAuthState?.(state);
  }
  const parent = state.parentDeviceId === deviceId;
  return json({ token: issue(state, parent ? 'parent' : 'guest', parent ? 'parent' : `secondary:${deviceId}`, deviceId), role: parent ? 'parent' : 'guest', label: parent ? 'Parent admin' : 'Read-only access' });
}

export async function handleAdminSessionAction(req: Request, store: Store): Promise<Response> {
  const session = await authenticateAdmin(req, store);
  if (!session) return json({ error: 'Your admin session expired. Sign in again.' }, 401);
  const state = await getAdminState(store);
  if (!state) return json({ error: 'Admin sign-in is unavailable.' }, 503);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? 'refresh');

  if (action === 'refresh') return json({ token: issue(state, session.role, session.id, session.deviceId), role: session.role });
  if (session.role !== 'parent') return json({ error: 'Only the parent admin can change account security.' }, 403);

  if (action === 'change-password') {
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!equalHex(await hashPassword(current, state.salt), state.passwordHash)) return json({ error: 'The current password is incorrect.' }, 401);
    if (next.length < 12 || next.length > 128) return json({ error: 'Use a new password between 12 and 128 characters.' }, 400);
    if (equalHex(await hashPassword(next, state.salt), state.passwordHash)) return json({ error: 'Choose a different password.' }, 400);
    state.salt = randomBytes(16).toString('base64url');
    state.passwordHash = await hashPassword(next, state.salt);
    state.sessionVersion++;
    state.ownerTokenVersion = ownerVersion(secret(), `${state.salt}:${state.passwordHash}:${state.sessionVersion}`);
    await store.putAdminAuthState?.(state);
    return json({ token: issue(state, 'parent', 'parent', session.deviceId), role: 'parent', message: 'Password updated. Other admin sessions have been signed out.' });
  }

  if (action === 'logout-others') {
    state.sessionVersion++;
    await store.putAdminAuthState?.(state);
    return json({ token: issue(state, 'parent', 'parent', session.deviceId), role: 'parent', message: 'Other admin sessions have been signed out.' });
  }
  return json({ error: 'Unknown admin session action.' }, 400);
}

async function requireParent(req: Request, store: Store): Promise<{ session: AdminSession; state: AdminAuthState } | Response> {
  const session = await authenticateAdmin(req, store);
  if (!session) return json({ error: 'Your admin session expired. Sign in again.' }, 401);
  if (session.role !== 'parent') return json({ error: 'Read-only guest accounts cannot manage other accounts.' }, 403);
  const state = await getAdminState(store);
  if (!state) return json({ error: 'Admin sign-in is unavailable.' }, 503);
  return { session, state };
}

export async function handleGuestList(req: Request, store: Store): Promise<Response> {
  const result = await requireParent(req, store);
  if (result instanceof Response) return result;
  return json({ guests: result.state.guests.map(({ id, username, label, active, createdAt }) => ({ id, username, label, active, createdAt })) });
}

export async function handleGuestCreate(req: Request, store: Store): Promise<Response> {
  const result = await requireParent(req, store);
  if (result instanceof Response) return result;
  const body = await req.json().catch(() => ({}));
  const username = normalUsername(body?.username);
  const label = String(body?.label ?? '').trim().slice(0, 60);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) return json({ error: 'Guest username must be 3–32 letters, numbers, dots, underscores or hyphens.' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'Guest passwords must contain at least 10 characters.' }, 400);
  if (result.state.guests.some((g) => g.username === username)) return json({ error: 'That guest username already exists.' }, 409);
  const salt = randomBytes(16).toString('base64url');
  const guest: AdminGuest = { id: randomBytes(12).toString('hex'), username, label, salt, passwordHash: await hashPassword(password, salt), active: true, createdAt: new Date().toISOString() };
  result.state.guests.push(guest);
  await store.putAdminAuthState?.(result.state);
  return json({ guest: { id: guest.id, username, label, active: true, createdAt: guest.createdAt } }, 201);
}

export async function handleGuestDelete(req: Request, store: Store): Promise<Response> {
  const result = await requireParent(req, store);
  if (result instanceof Response) return result;
  const body = await req.json().catch(() => ({}));
  const guest = result.state.guests.find((g) => g.id === body?.id);
  if (!guest) return json({ error: 'Guest account not found.' }, 404);
  guest.active = false;
  await store.putAdminAuthState?.(result.state);
  return json({ revoked: guest.id });
}

/** Internal helper used by owner activation. It never returns the stored password or hash to clients. */
export async function authenticateParentPassword(store: Store, password: unknown): Promise<AdminAuthState | null> {
  const state = await getAdminState(store);
  if (!state || typeof password !== 'string') return null;
  return equalHex(await hashPassword(password, state.salt), state.passwordHash) ? state : null;
}
