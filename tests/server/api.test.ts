import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, post } from './memory-store';
import { handleOwner, handleValidate, handleVerify } from '../../server/license-api';
import { handleAnswer } from '../../server/answer';
import { adminCreate, adminDelete, adminGet, adminPatch } from '../../server/admin-api';
import { preflight } from '../../server/http';
import { createLicenses } from '../../server/license';
import { resetModelCache } from '../../server/gemini';

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.TOKEN_SECRET = 'test-secret';
  process.env.ADMIN_PASSWORD = 'correct horse battery';
  process.env.GEMINI_API_KEY = 'fake-gemini';
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

/* ---------------- owner sign-in ---------------- */
const ownerReq = (password: unknown, deviceId: unknown = 'owner-phone-001', ip = '5.5.5.5') =>
  post('/api/license/owner', { password, deviceId }, { 'x-forwarded-for': ip });

test('owner: admin password signs a device in, no license key needed', async () => {
  const st = memoryStore();
  const r = await handleOwner(ownerReq('correct horse battery'), st);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.owner, true);
  const v = await handleVerify(post('/v', { token: d.token, deviceId: 'owner-phone-001' }), st);
  assert.equal(v.status, 200);
  assert.equal((await handleVerify(post('/v', { token: d.token, deviceId: 'other-phone-002' }), st)).status, 401, 'token is bound to the device');
});

test('owner: wrong password, missing device and brute force', async () => {
  const st = memoryStore();
  assert.equal((await handleOwner(ownerReq('nope'), st)).status, 401);
  assert.equal((await handleOwner(ownerReq('correct horse battery', 'x'), st)).status, 400);
  for (let i = 0; i < 7; i++) await handleOwner(ownerReq('nope'), st);
  assert.equal((await handleOwner(ownerReq('correct horse battery'), st)).status, 429, 'blocked after repeated failures');
  assert.equal((await handleOwner(ownerReq('correct horse battery', 'owner-phone-001', '6.6.6.6'), st)).status, 200, 'other IPs unaffected');
});

test('owner: no ADMIN_PASSWORD configured means no owner access', async () => {
  delete process.env.ADMIN_PASSWORD;
  assert.equal((await handleOwner(ownerReq(''), memoryStore())).status, 500);
});

test('owner: changing ADMIN_PASSWORD signs every owner device out', async () => {
  const st = memoryStore();
  const { token } = await (await handleOwner(ownerReq('correct horse battery'), st)).json();
  process.env.ADMIN_PASSWORD = 'a brand new password';
  const v = await handleVerify(post('/v', { token, deviceId: 'owner-phone-001' }), st);
  assert.equal(v.status, 403);
});

test('a student cannot turn a license token into an owner token', async () => {
  const { st, token } = await activated();
  const [b, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url').toString()), o: 1, v: 'x' })).toString('base64url') + '.' + sig;
  assert.equal((await handleVerify(post('/v', { token: forged, deviceId: 'device-phone-1' }), st)).status, 401);
});

/* ---------------- /api/answer ---------------- */
const STUDENT_KEY = 'AIzaStudentOwnKey_1234567890abcdef';
const fakeGemini = (status = 200, answer = 'Four') => {
  const calls: { url: string; key: string | null }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, key: new Headers(init?.headers).get('x-goog-api-key') });
    if (u.includes('/models?')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }));
    if (status !== 200) return new Response(JSON.stringify({ error: { message: status === 400 ? 'API key not valid. Please pass a valid API key.' : 'boom' } }), { status });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ label: 'Question 1', answer }] }) }] } }] }));
  }) as typeof fetch;
  return calls;
};
const ans = (h: Record<string, string>, body: unknown = { images: [img], style: 'quick' }) => post('/api/answer', body, h);
const withKey = (h: Record<string, string>) => ({ ...h, 'x-gemini-key': STUDENT_KEY });

test('answer: needs a valid license (no token, wrong device, revoked)', async () => {
  const { st, lic, h } = await activated();
  fakeGemini();
  const none = await handleAnswer(ans({}), st);
  assert.equal(none.status, 401);
  assert.equal((await none.json()).code, 'license');
  assert.equal((await handleAnswer(ans({ ...withKey(h), 'x-device-id': 'device-phone-2' }), st)).status, 401);
  const l = (await st.get(lic.key))!; l.status = 'revoked'; await st.put(l);
  const revoked = await handleAnswer(ans(withKey(h)), st);
  assert.equal(revoked.status, 403);
  assert.equal((await revoked.json()).code, 'license');
});

test('answer: a student must bring their own Gemini key', async () => {
  const { st, h } = await activated();
  const calls = fakeGemini();
  const r = await handleAnswer(ans(h), st);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'need_key');
  assert.equal((await handleAnswer(ans({ ...h, 'x-gemini-key': 'short' }), st)).status, 400);
  assert.equal(calls.length, 0, 'nothing was sent to Google');
});

test('answer: student key is used for Google and the server key is never used or leaked', async () => {
  const { st, h } = await activated();
  const calls = fakeGemini(200, 'Four');
  const r = await handleAnswer(ans(withKey(h)), st);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.text, 'Question 1. Four');
  assert.ok(calls.length >= 2 && calls.every((c) => c.key === STUDENT_KEY), 'every Google call used the student key');
  const out = JSON.stringify(d);
  assert.ok(!out.includes('fake-gemini') && !out.includes(STUDENT_KEY));
});

test('answer: owner devices use the server key and need no key of their own', async () => {
  const st = memoryStore();
  const { token } = await (await handleOwner(ownerReq('correct horse battery'), st)).json();
  const calls = fakeGemini(200, 'Seven');
  const r = await handleAnswer(ans({ 'x-license-token': token, 'x-device-id': 'owner-phone-001' }), st);
  assert.equal(r.status, 200);
  assert.ok(calls.length >= 2 && calls.every((c) => c.key === 'fake-gemini'));
  delete process.env.GEMINI_API_KEY;
  assert.equal((await handleAnswer(ans({ 'x-license-token': token, 'x-device-id': 'owner-phone-001' }), st)).status, 500);
});

test('answer: Google rejecting or limiting a student key gives a clear message, not a server error', async () => {
  const { st, h } = await activated();
  fakeGemini(400);
  const bad = await handleAnswer(ans(withKey(h)), st);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'student_key');
  fakeGemini(429);
  const lim = await handleAnswer(ans(withKey(h)), st);
  assert.equal(lim.status, 429);
  assert.equal((await lim.json()).code, 'student_limit');
});

test('answer: bad images are rejected before reaching Google', async () => {
  const { st, h } = await activated();
  const calls = fakeGemini();
  assert.equal((await handleAnswer(ans(withKey(h), { images: ['not-an-image'] }), st)).status, 400);
  assert.equal((await handleAnswer(ans(withKey(h), { images: [] }), st)).status, 400);
  assert.equal((await handleAnswer(ans(withKey(h), { images: ['data:text/html;base64,AAAA'] }), st)).status, 400);
  assert.equal(calls.length, 0);
});

test('answer: oversized request and burst limit', async () => {
  const { st, h } = await activated();
  fakeGemini();
  const big = new Request('http://x/api/answer', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '5000000', ...withKey(h) }, body: '{}' });
  assert.equal((await handleAnswer(big, st)).status, 413);
  for (let i = 0; i < 12; i++) assert.equal((await handleAnswer(ans(withKey(h)), st)).status, 200);
  assert.equal((await handleAnswer(ans(withKey(h)), st)).status, 429, 'the 13th in 10 minutes is refused');
});
