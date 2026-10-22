import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export interface License {
  key: string;
  label: string;
  status: 'active' | 'revoked';
  maxDevices: number;
  devices: string[];
  createdAt: string;
  activatedAt?: string;
}

export interface Store {
  get(key: string): Promise<License | null>;
  put(lic: License): Promise<void>;
  del(key: string): Promise<void>;
  list(): Promise<License[]>;
  /** Adds `delta` to a counter that expires after `ttlSec`; returns the new value. delta 0 just reads. */
  hit(key: string, ttlSec: number, delta?: number): Promise<number>;
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

export function signToken(k: string, d: string, secret: string): string {
  const body = b64(JSON.stringify({ k, d, t: Date.now() }));
  return `${body}.${b64(mac(body, secret))}`;
}

export function readToken(token: unknown, secret: string): { k: string; d: string } | null {
  if (typeof token !== 'string' || !secret) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = mac(body, secret);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof p.k === 'string' && typeof p.d === 'string' ? { k: p.k, d: p.d } : null;
  } catch {
    return null;
  }
}

/** First activation binds the key to this device. Other devices are refused once maxDevices is used. */
export async function activate(
  store: Store, secret: string, keyRaw: unknown, deviceId: unknown,
): Promise<{ ok: true; token: string } | Fail> {
  const key = normKey(keyRaw);
  if (!key || !validDevice(deviceId)) return { ok: false, status: 400, error: 'Missing license key or device.' };
  const lic = await store.get(key);
  if (!lic) return { ok: false, status: 404, error: 'Invalid license key.' };
  if (lic.status !== 'active') return { ok: false, status: 403, error: 'This license has been revoked.' };
  if (!lic.devices.includes(deviceId)) {
    if (lic.devices.length >= lic.maxDevices) {
      return { ok: false, status: 403, error: 'This license is already used on another device.' };
    }
    lic.devices.push(deviceId);
    lic.activatedAt ??= new Date().toISOString();
    await store.put(lic);
  }
  return { ok: true, token: signToken(key, deviceId, secret) };
}

/** Token must be genuine, for this device, and the license must still be active and bound here. */
export async function verify(
  store: Store, secret: string, token: unknown, deviceId: unknown,
): Promise<{ ok: true; key: string } | Fail> {
  const p = readToken(token, secret);
  if (!p || !validDevice(deviceId) || p.d !== deviceId) return { ok: false, status: 401, error: 'Invalid token.' };
  const lic = await store.get(p.k);
  if (!lic) return { ok: false, status: 403, error: 'License no longer valid.' };
  if (lic.status !== 'active') return { ok: false, status: 403, error: 'This license has been revoked.' };
  if (!lic.devices.includes(deviceId)) return { ok: false, status: 403, error: 'License no longer valid for this device.' };
  return { ok: true, key: lic.key };
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
