import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export interface License {
  key: string;
  label: string;
  status: 'active' | 'revoked';
  maxDevices: number;
  devices: string[];
  createdAt: string;
  activatedAt?: string;
  /** When the student last moved this key to a new phone (ms since epoch). Limits self-service moves. */
  lastTransferMs?: number;
}

/** A student can move their key to a new phone themselves once per this period. */
export const TRANSFER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export type TransferResult =
  | { status: 'ok'; license: License }
  | { status: 'missing' | 'revoked' }
  | { status: 'cooldown'; retryAtMs: number };

/** Decode the tuple returned by the atomic Redis transfer Lua script. */
export function parseTransferResult(raw: unknown): TransferResult {
  if (Array.isArray(raw) && raw[0] === 'cooldown') {
    const retryAtMs = Number(raw[1]);
    if (!Number.isFinite(retryAtMs)) throw new Error('Atomic transfer returned an invalid retry time.');
    return { status: 'cooldown', retryAtMs };
  }
  const claim = parseDeviceClaimResult(raw);
  if (claim.status === 'ok') return claim;
  if (claim.status === 'missing' || claim.status === 'revoked') return { status: claim.status };
  throw new Error('Atomic transfer returned an unexpected limit status.');
}

/**
 * The move itself, shared by the in-memory/fallback path and mirrored by the Redis Lua script:
 * a phone already on the key is fine; a free slot is simply used; a full key drops its oldest phone,
 * at most once per cooldown period.
 */
export function applyTransfer(lic: License, deviceId: string, nowMs: number, cooldownMs = TRANSFER_COOLDOWN_MS): TransferResult {
  if (lic.status !== 'active') return { status: 'revoked' };
  if (lic.devices.includes(deviceId)) return { status: 'ok', license: lic };
  if (lic.devices.length >= lic.maxDevices) {
    const last = lic.lastTransferMs ?? 0;
    if (last > 0 && nowMs - last < cooldownMs) return { status: 'cooldown', retryAtMs: last + cooldownMs };
    lic.devices = lic.devices.slice(lic.devices.length - lic.maxDevices + 1);
    lic.lastTransferMs = nowMs;
  }
  lic.devices.push(deviceId);
  lic.activatedAt ??= new Date(nowMs).toISOString();
  return { status: 'ok', license: lic };
}

export type DeviceClaim =
  | { status: 'ok'; license: License }
  | { status: 'missing' | 'revoked' | 'limit' };

/** Decode the tuple returned by the atomic Redis device-claim Lua script. */
export function parseDeviceClaimResult(raw: unknown): DeviceClaim {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string') {
    throw new Error('Atomic device claim returned an invalid response.');
  }

  const [status, serializedLicense] = raw as [string, unknown?];
  switch (status) {
    case 'missing':
    case 'revoked':
    case 'limit':
      return { status };
    case 'ok': {
      if (typeof serializedLicense !== 'string' || !serializedLicense) {
        throw new Error('Atomic device claim returned no license data.');
      }
      const parsed: unknown = JSON.parse(serializedLicense);
      if (
        !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        typeof (parsed as License).key !== 'string' ||
        ((parsed as License).status !== 'active' && (parsed as License).status !== 'revoked') ||
        !Array.isArray((parsed as License).devices) ||
        typeof (parsed as License).maxDevices !== 'number'
      ) {
        throw new Error('Atomic device claim returned malformed license data.');
      }
      return { status: 'ok', license: parsed as License };
    }
    default:
      throw new Error(`Unexpected atomic device claim status: ${status}`);
  }
}

export interface AdminGuest { id: string; username: string; label: string; salt: string; passwordHash: string; active: boolean; createdAt: string }
export interface AdminAuthState { salt: string; passwordHash: string; sessionVersion: number; parentDeviceId: string | null; ownerTokenVersion: string; guests: AdminGuest[];
  /** Fingerprint of the ADMIN_PASSWORD env value last applied. A new env value resets the parent password. */
  envFingerprint?: string }

export interface Store {
  get(key: string): Promise<License | null>;
  put(lic: License): Promise<void>;
  del(key: string): Promise<void>;
  list(): Promise<License[]>;
  /** Atomically bind a device without allowing concurrent activations to exceed maxDevices. */
  claimDevice?(key: string, deviceId: string): Promise<DeviceClaim>;
  /** Atomically move the key to this device (see applyTransfer). */
  transferDevice?(key: string, deviceId: string, nowMs: number, cooldownMs: number): Promise<TransferResult>;
  /** Adds `delta` to a counter that expires after `ttlSec`; returns the new value. delta 0 just reads. */
  hit(key: string, ttlSec: number, delta?: number): Promise<number>;
  /** Persistent parent-admin credentials and guest accounts. Optional only for lightweight test/custom stores. */
  getAdminAuthState?(): Promise<AdminAuthState | null>;
  putAdminAuthState?(state: AdminAuthState): Promise<void>;
}

export type Fail = { ok: false; status: number; error: string };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const normKey = (s: unknown) => String(s ?? '').trim().toUpperCase();
export const validDevice = (d: unknown): d is string => typeof d === 'string' && d.length >= 8 && d.length <= 200;

export function newKey(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `EXAM-${group()}-${group()}-${group()}`;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest();

/** Owner tokens carry a version of the admin password, so a password change (in the app or via ADMIN_PASSWORD) signs every owner device out. */
export const ownerVersion = (secret: string, adminPassword: string) =>
  createHash('sha256').update(`${secret}:${adminPassword}`).digest('hex').slice(0, 16);

/** Fingerprint of an ADMIN_PASSWORD env value, stored so a changed env value can be detected without keeping the password. */
export const adminEnvFingerprint = (secret: string, password: string) =>
  createHmac('sha256', secret).update('admin-env:' + password).digest('hex').slice(0, 32);

export function signToken(k: string, d: string, secret: string, owner?: { v: string }): string {
  const body = b64(JSON.stringify({ k, d, t: Date.now(), ...(owner ? { o: 1, v: owner.v } : {}) }));
  return `${body}.${b64(mac(body, secret))}`;
}

export function readToken(token: unknown, secret: string): { k: string; d: string; o: boolean; v: string } | null {
  if (typeof token !== 'string' || !secret) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = mac(body, secret);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof p.k === 'string' && typeof p.d === 'string' ? { k: p.k, d: p.d, o: p.o === 1, v: String(p.v ?? '') } : null;
  } catch {
    return null;
  }
}

/** First activation binds the key to this device. Other devices are refused once maxDevices is used. */
export async function activate(
  store: Store, secret: string, keyRaw: unknown, deviceId: unknown,
): Promise<{ ok: true; token: string } | (Fail & { inUse?: boolean })> {
  const key = normKey(keyRaw);
  if (!key || !validDevice(deviceId)) return { ok: false, status: 400, error: 'Missing license key or device.' };
  if (store.claimDevice) {
    const claim = await store.claimDevice(key, deviceId);
    if (claim.status === 'missing') return { ok: false, status: 404, error: 'Invalid license key.' };
    if (claim.status === 'revoked') return { ok: false, status: 403, error: 'This license has been revoked.' };
    if (claim.status === 'limit') return { ok: false, status: 403, error: 'This license is already used on another device.', inUse: true };
  } else {
    // Compatibility path for test/custom stores. Production Upstash store implements atomic claimDevice.
    const lic = await store.get(key);
    if (!lic) return { ok: false, status: 404, error: 'Invalid license key.' };
    if (lic.status !== 'active') return { ok: false, status: 403, error: 'This license has been revoked.' };
    if (!lic.devices.includes(deviceId)) {
      if (lic.devices.length >= lic.maxDevices) {
        return { ok: false, status: 403, error: 'This license is already used on another device.', inUse: true };
      }
      lic.devices.push(deviceId);
      lic.activatedAt ??= new Date().toISOString();
      await store.put(lic);
    }
  }
  return { ok: true, token: signToken(key, deviceId, secret) };
}

/** Token must be genuine, for this device, and the license must still be active and bound here. */
export async function verify(
  store: Store, secret: string, token: unknown, deviceId: unknown, adminPassword = process.env.ADMIN_PASSWORD || '',
): Promise<{ ok: true; key: string; owner: boolean } | Fail> {
  const p = readToken(token, secret);
  if (!p || !validDevice(deviceId) || p.d !== deviceId) return { ok: false, status: 401, error: 'Invalid token.' };
  if (p.o) {
    // Existing owner devices are revoked when the parent admin changes their password.
    const authState = await store.getAdminAuthState?.();
    // A changed ADMIN_PASSWORD revokes owner devices at once, even before the next admin sign-in applies it.
    if (authState?.envFingerprint && adminPassword && authState.envFingerprint !== adminEnvFingerprint(secret, adminPassword)) {
      return { ok: false, status: 403, error: 'Owner sign-in expired. Sign in again.' };
    }
    const currentVersion = authState?.ownerTokenVersion || (adminPassword ? ownerVersion(secret, adminPassword) : '');
    if (!currentVersion || p.v !== currentVersion) return { ok: false, status: 403, error: 'Owner sign-in expired. Sign in again.' };
    return { ok: true, key: 'OWNER', owner: true };
  }
  const lic = await store.get(p.k);
  if (!lic) return { ok: false, status: 403, error: 'License no longer valid.' };
  if (lic.status !== 'active') return { ok: false, status: 403, error: 'This license has been revoked.' };
  if (!lic.devices.includes(deviceId)) {
    return { ok: false, status: 403, error: lic.lastTransferMs ? 'Your license was moved to another phone. Enter the key again to move it back.' : 'License no longer valid for this device.' };
  }
  return { ok: true, key: lic.key, owner: false };
}

export async function createLicenses(store: Store, label: string, count: number, maxDevices: number) {
  const out: License[] = [];
  for (let i = 0; i < count; i++) {
    const lic: License = {
      key: newKey(), label, status: 'active', maxDevices, devices: [], createdAt: new Date().toISOString(),
    };
    await store.put(lic);
    out.push(lic);
  }
  return out;
}

/** Owner sign-in: the admin password stands in for a license key. Never needs a key, works on any number of devices. */
export function activateOwner(
  secret: string, adminPassword: string, password: unknown, deviceId: unknown, same: (a: string, b: string) => boolean,
): { ok: true; token: string } | Fail {
  if (!adminPassword) return { ok: false, status: 500, error: 'The server has no ADMIN_PASSWORD set.' };
  if (!validDevice(deviceId)) return { ok: false, status: 400, error: 'Missing device.' };
  if (typeof password !== 'string' || !same(password, adminPassword)) return { ok: false, status: 401, error: 'Wrong password.' };
  return { ok: true, token: signToken('OWNER', deviceId, secret, { v: ownerVersion(secret, adminPassword) }) };
}

/** Whether a key that is full could be moved to a new phone now, and if not, when. */
export function transferAvailability(lic: License, nowMs = Date.now(), cooldownMs = TRANSFER_COOLDOWN_MS): { canTransfer: boolean; retryAt?: string } {
  const last = lic.lastTransferMs ?? 0;
  if (last > 0 && nowMs - last < cooldownMs) return { canTransfer: false, retryAt: new Date(last + cooldownMs).toISOString() };
  return { canTransfer: true };
}

/** Self-service move: binds the key to this device, signing out its oldest phone. Limited to once per cooldown. */
export async function transfer(
  store: Store, secret: string, keyRaw: unknown, deviceId: unknown, nowMs = Date.now(),
): Promise<{ ok: true; token: string } | (Fail & { retryAt?: string })> {
  const key = normKey(keyRaw);
  if (!key || !validDevice(deviceId)) return { ok: false, status: 400, error: 'Missing license key or device.' };
  let result: TransferResult;
  if (store.transferDevice) {
    result = await store.transferDevice(key, deviceId, nowMs, TRANSFER_COOLDOWN_MS);
  } else {
    // Compatibility path for test/custom stores. Production Upstash store implements atomic transferDevice.
    const current = await store.get(key);
    if (!current) return { ok: false, status: 404, error: 'Invalid license key.' };
    result = applyTransfer(current, deviceId, nowMs);
    if (result.status === 'ok') await store.put(result.license);
  }
  if (result.status === 'missing') return { ok: false, status: 404, error: 'Invalid license key.' };
  if (result.status === 'revoked') return { ok: false, status: 403, error: 'This license has been revoked.' };
  if (result.status === 'cooldown') {
    const retryAt = new Date(result.retryAtMs).toISOString();
    return { ok: false, status: 429, error: 'This key was moved to a new phone recently. It can be moved again after the date shown.', retryAt };
  }
  return { ok: true, token: signToken(key, deviceId, secret) };
}
