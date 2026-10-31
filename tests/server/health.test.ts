import test from 'node:test';
import assert from 'node:assert/strict';
import { health } from '../../server/health';
import { safe } from '../../server/http';
import { adminGet } from '../../server/admin-api';
import { handleValidate } from '../../server/license-api';
import { memoryStore, post } from './memory-store';
import type { Store } from '../../server/license';

const goodEnv = {
  ADMIN_PASSWORD: 'super secret admin password', TOKEN_SECRET: 'a'.repeat(64), GEMINI_API_KEY: 'AIzaServerKey123',
  UPSTASH_REDIS_REST_URL: 'https://eager-owl-1234.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'AXabcDEF-token', VERCEL_ENV: 'production',
};
const brokenStore = (): Store => {
  const boom = async () => { throw new Error('fetch failed'); };
  return { get: boom, put: boom, del: boom, list: boom, hit: boom } as unknown as Store;
};
const adminReq = () => new Request('http://x/api/admin/licenses', { headers: { authorization: 'Bearer super secret admin password', 'x-forwarded-for': '1.1.1.1' } });

test('health: all good', async () => {
  const h = await health(memoryStore(), goodEnv);
  assert.equal(h.ok, true);
  assert.equal(h.database, 'ok');
  assert.deepEqual(h.hints, []);
});

test('health: never reveals secret values', async () => {
  const out = JSON.stringify(await health(memoryStore(), goodEnv));
  for (const secret of Object.values(goodEnv)) if (secret !== 'production') assert.ok(!out.includes(secret), 'leaked ' + secret);
});

test('health: nothing configured gives plain-language hints', async () => {
  const h = await health(memoryStore(), {});
  assert.equal(h.ok, false);
  assert.equal(h.database, 'not configured');
  const text = h.hints.join(' ');
  for (const k of ['ADMIN_PASSWORD', 'TOKEN_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) assert.match(text, new RegExp(k));
});

test('health: warns when token secret is too short', async () => {
  const h = await health(memoryStore(), { ...goodEnv, TOKEN_SECRET: 'too-short' });
  assert.equal(h.ok, false);
  assert.match(h.hints.join(' '), /TOKEN_SECRET is too short.*at least 32 random characters/i);
});

test('health: catches the redis:// connection string mistake', async () => {
  const h = await health(memoryStore(), { ...goodEnv, UPSTASH_REDIS_REST_URL: 'rediss://default:pw@eager-owl.upstash.io:6379' });
  assert.match(h.hints.join(' '), /must start with https/);
});

test('health: unreachable database is reported', async () => {
  const h = await health(brokenStore(), goodEnv);
  assert.equal(h.ok, false);
  assert.match(h.database, /cannot connect/);
  assert.match(h.hints.join(' '), /did not answer/);
});

test('health: warns when this is a preview deployment', async () => {
  const h = await health(memoryStore(), { ...goodEnv, VERCEL_ENV: 'preview' });
  assert.match(h.hints.join(' '), /"preview" deployment/);
});

test('REGRESSION: a dead database used to give a bare 500; now it is readable JSON the page can show', async () => {
  process.env.ADMIN_PASSWORD = 'super secret admin pw';
  await assert.rejects(() => adminGet(adminReq(), brokenStore()), /fetch failed/); // what used to become "Request failed"
  const res = await safe((req) => adminGet(req, brokenStore()))(adminReq());
  assert.equal(res.status, 503);
  const d = await res.json();
  assert.equal(d.code, 'server');
  assert.match(d.error, /database/);
  assert.match(d.error, /api\/health/);
});

test('safe: the phone app also gets a readable message when activation hits a dead database', async () => {
  process.env.TOKEN_SECRET = 'x-secret';
  const res = await safe((req) => handleValidate(req, brokenStore()))(post('/v', { licenseKey: 'EXAM-AAAA-AAAA-AAAA', deviceId: 'device-phone-1' }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /database/);
});

test('safe: passes normal responses through untouched', async () => {
  const res = await safe(async () => new Response('hi', { status: 201 }))(new Request('http://x'));
  assert.equal(res.status, 201);
});
