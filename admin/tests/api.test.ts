import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, post } from './memory-store';
import { handleValidate, handleVerify } from '../lib/license-api';
import { handleAnswer } from '../lib/answer';
import { adminCreate, adminDelete, adminGet, adminPatch } from '../lib/admin-api';
import { preflight } from '../lib/http';
import { createLicenses } from '../lib/license';
import { resetModelCache } from '../lib/gemini';

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.TOKEN_SECRET = 'test-secret';
  process.env.ADMIN_PASSWORD = 'correct horse battery';
  process.env.GEMINI_API_KEY = 'fake-gemini';
  process.env.DAILY_LIMIT = '2';
  resetModelCache();
});
afterEach(() => { globalThis.fetch = realFetch; });

const img = 'data:image/jpeg;base64,/9j/4AAQ';
const admin = (method: string, body?: unknown, pw = 'correct horse battery', ip = '1.1.1.1') =>
  new Request('http://x/api/admin/licenses', {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${pw}`, 'x-forwarded-for': ip },
    body: body ? JSON.stringify(body) : undefined,
  });

async function activated(st = memoryStore()) {
  const [lic] = await createLicenses(st, 'S', 1, 1);
  const res = await handleValidate(post('/api/license/validate', { licenseKey: lic.key, deviceId: 'device-phone-1' }), st);
  const { token } = await res.json();
  return { st, lic, token: token as string, h: { 'x-license-token': token, 'x-device-id': 'device-phone-1' } };
}

test('validate and verify over HTTP, with CORS headers', async () => {
  const { st, lic, token } = await activated();
  const ok = await handleValidate(post('/v', { licenseKey: lic.key, deviceId: 'device-phone-1' }), st);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), '*');
  const v = await handleVerify(post('/v', { token, deviceId: 'device-phone-1' }), st);
  assert.equal(v.status, 200);
  const other = await handleVerify(post('/v', { token, deviceId: 'device-phone-2' }), st);
  assert.equal(other.status, 401);
  const pf = preflight();
  assert.equal(pf.status, 204);
  assert.match(pf.headers.get('access-control-allow-headers')!, /x-license-token/);
  assert.match(pf.headers.get('access-control-allow-headers')!, /x-device-id/);
});

test('shared key on a second device is refused with a clear message', async () => {
  const { st, lic } = await activated();
  const r = await handleValidate(post('/v', { licenseKey: lic.key, deviceId: 'device-phone-2' }), st);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /another device/);
});

test('guessing keys gets an IP blocked after 15 misses', async () => {
  const st = memoryStore();
  const req = () => post('/v', { licenseKey: 'EXAM-AAAA-AAAA-AAAA', deviceId: 'device-phone-1' }, { 'x-forwarded-for': '9.9.9.9' });
  for (let i = 0; i < 15; i++) assert.equal((await handleValidate(req(), st)).status, 404);
  assert.equal((await handleValidate(req(), st)).status, 429);
  const [lic] = await createLicenses(st, '', 1, 1);
  const other = await handleValidate(post('/v', { licenseKey: lic.key, deviceId: 'device-phone-1' }, { 'x-forwarded-for': '8.8.8.8' }), st);
  assert.equal(other.status, 200, 'other IPs are unaffected');
});

test('server without TOKEN_SECRET refuses to issue tokens', async () => {
  delete process.env.TOKEN_SECRET;
  const st = memoryStore();
  const [lic] = await createLicenses(st, '', 1, 1);
  assert.equal((await handleValidate(post('/v', { licenseKey: lic.key, deviceId: 'device-phone-1' }), st)).status, 500);
});

/* ---------------- admin ---------------- */
test('admin: wrong password is rejected and brute force is blocked', async () => {
  const st = memoryStore();
  assert.equal((await adminGet(admin('GET', undefined, 'nope'), st)).status, 401);
  for (let i = 0; i < 7; i++) await adminGet(admin('GET', undefined, 'nope'), st);
  assert.equal((await adminGet(admin('GET', undefined, 'correct horse battery'), st)).status, 429, 'locked even for the right password');
  assert.equal((await adminGet(admin('GET', undefined, 'correct horse battery', '2.2.2.2'), st)).status, 200, 'other IP fine');
});

test('admin: no password configured means nobody gets in', async () => {
  delete process.env.ADMIN_PASSWORD;
  assert.equal((await adminGet(admin('GET', undefined, ''), memoryStore())).status, 401);
});

test('admin: create, list, rename, revoke, restore, reset, delete', async () => {
  const st = memoryStore();
  const c = await (await adminCreate(admin('POST', { label: ' Brian ', count: 3, maxDevices: 2 }), st)).json();
  assert.equal(c.licenses.length, 3);
  assert.equal(c.licenses[0].label, 'Brian');
  assert.equal(c.licenses[0].maxDevices, 2);
  const key = c.licenses[0].key;

  const list = await (await adminGet(admin('GET'), st)).json();
  assert.equal(list.licenses.length, 3);

  await adminPatch(admin('PATCH', { key, action: 'rename', label: 'Brian K' }), st);
  assert.equal((await st.get(key))!.label, 'Brian K');
  await adminPatch(admin('PATCH', { key: key.toLowerCase(), action: 'revoke' }), st);
  assert.equal((await st.get(key))!.status, 'revoked');
  await adminPatch(admin('PATCH', { key, action: 'restore' }), st);
  assert.equal((await st.get(key))!.status, 'active');
  assert.equal((await adminPatch(admin('PATCH', { key, action: 'explode' }), st)).status, 400);
  assert.equal((await adminPatch(admin('PATCH', { key: 'EXAM-NOPE', action: 'revoke' }), st)).status, 404);

  await handleValidate(post('/v', { licenseKey: key, deviceId: 'device-phone-1' }), st);
  assert.equal((await st.get(key))!.devices.length, 1);
  await adminPatch(admin('PATCH', { key, action: 'reset' }), st);
  assert.equal((await st.get(key))!.devices.length, 0);

  assert.equal((await adminDelete(admin('DELETE', { key }), st)).status, 200);
  assert.equal(await st.get(key), null);
  assert.equal((await adminDelete(admin('DELETE', { key }), st)).status, 404);
});

test('admin: count and device limits are clamped', async () => {
  const st = memoryStore();
  const c = await (await adminCreate(admin('POST', { count: 9999, maxDevices: 9999 }), st)).json();
  assert.equal(c.licenses.length, 50);
  assert.equal(c.licenses[0].maxDevices, 10);
  const d = await (await adminCreate(admin('POST', { count: 'abc', maxDevices: -4 }), st)).json();
  assert.equal(d.licenses.length, 1);
  assert.equal(d.licenses[0].maxDevices, 1);
});

/* ---------------- /api/answer ---------------- */
const fakeGemini = (status = 200, answer = 'Four') => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/models?')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }));
    if (status !== 200) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ label: 'Question 1', answer }] }) }] } }] }));
  }) as typeof fetch;
  return calls;
};
const ans = (h: Record<string, string>, body: unknown = { images: [img], style: 'quick' }) => post('/api/answer', body, h);

test('answer: needs a valid license (no token, wrong device, revoked)', async () => {
  const { st, lic, h } = await activated();
  fakeGemini();
  const none = await handleAnswer(ans({}), st);
  assert.equal(none.status, 401);
  assert.equal((await none.json()).code, 'license');
  const wrongDevice = await handleAnswer(ans({ ...h, 'x-device-id': 'device-phone-2' }), st);
  assert.equal(wrongDevice.status, 401);
  const l = (await st.get(lic.key))!; l.status = 'revoked'; await st.put(l);
  const revoked = await handleAnswer(ans(h), st);
  assert.equal(revoked.status, 403);
  assert.equal((await revoked.json()).code, 'license');
});

test('answer: valid license gets answers, Gemini key never leaves the server', async () => {
  const { st, h } = await activated();
  const calls = fakeGemini(200, 'Four');
  const r = await handleAnswer(ans(h), st);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.text, 'Question 1. Four');
  assert.ok(calls.some((c) => c.includes('generateContent')));
  assert.ok(!JSON.stringify(d).includes('fake-gemini'));
});

test('answer: daily cap per license, failed photos are refunded', async () => {
  const { st, h } = await activated();
  fakeGemini(200);
  assert.equal((await handleAnswer(ans(h), st)).status, 200);
  assert.equal((await handleAnswer(ans(h), st)).status, 200);
  const third = await handleAnswer(ans(h), st);
  assert.equal(third.status, 429);
  assert.equal((await third.json()).code, 'quota');

  const f = await activated();
  fakeGemini(500);
  for (let i = 0; i < 4; i++) assert.equal((await handleAnswer(ans(f.h), f.st)).status, 502);
  fakeGemini(200);
  assert.equal((await handleAnswer(ans(f.h), f.st)).status, 200, 'failures did not use up the allowance');
});

test('answer: rejects bad images and missing config without spending quota', async () => {
  const { st, h } = await activated();
  fakeGemini();
  assert.equal((await handleAnswer(ans(h, { images: ['not-an-image'] }), st)).status, 400);
  assert.equal((await handleAnswer(ans(h, { images: [] }), st)).status, 400);
  assert.equal((await handleAnswer(ans(h, { images: ['data:text/html;base64,AAAA'] }), st)).status, 400);
  assert.equal((await handleAnswer(ans(h), st)).status, 200);
  assert.equal((await handleAnswer(ans(h), st)).status, 200, 'earlier rejects were refunded');
  delete process.env.GEMINI_API_KEY;
  assert.equal((await handleAnswer(ans(h), st)).status, 500);
});

test('answer: oversized request is refused', async () => {
  const { st, h } = await activated();
  const big = new Request('http://x/api/answer', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '5000000', ...h }, body: '{}' });
  assert.equal((await handleAnswer(big, st)).status, 413);
});
