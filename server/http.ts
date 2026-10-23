import { createHash, timingSafeEqual } from 'node:crypto';
import type { Store } from './license';

// The app runs on its own origin (https://localhost on Android, another domain on the web),
// so these calls are cross-origin. No cookies are used; auth travels in headers/body.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-license-token, x-device-id, x-gemini-key',
  'access-control-max-age': '86400',
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });
export const preflight = () => new Response(null, { status: 204, headers: CORS });

export const secret = () => process.env.TOKEN_SECRET || '';
export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();

const digest = (s: string) => createHash('sha256').update(s).digest();
export const samePassword = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
export function isAdmin(req: Request): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  return samePassword((req.headers.get('authorization') || '').replace(/^Bearer /, ''), pw);
}

/** Failed-attempt limiter: blocks an IP after `max` failures in `ttlSec`. */
export const blocked = async (store: Store, bucket: string, ip: string, max: number, ttlSec = 600) =>
  (await store.hit(`${bucket}:${ip}`, ttlSec, 0)) >= max;
export const recordFail = (store: Store, bucket: string, ip: string, ttlSec = 600) =>
  store.hit(`${bucket}:${ip}`, ttlSec, 1);
