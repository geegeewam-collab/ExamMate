import test from 'node:test';
import assert from 'node:assert/strict';
import { activate, verify, createLicenses, readToken, newKey } from '../../server/license';
import { memoryStore } from './memory-store';

const S = 'test-secret';

test('keys look like EXAM-XXXX-XXXX-XXXX and are unique', () => {
  const ks = new Set(Array.from({ length: 200 }, newKey));
  assert.equal(ks.size, 200);
  for (const k of ks) assert.match(k, /^EXAM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
});

test('one license, one device: sharing the key with a friend fails', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, 'Student A', 1, 1);
  const a = await activate(st, S, '  ' + lic.key.toLowerCase() + ' ', 'device-phone-1');
  assert.ok(a.ok);
  assert.ok((await activate(st, S, lic.key, 'device-phone-1')).ok, 'same phone can re-activate');
  const b = await activate(st, S, lic.key, 'device-phone-2');
  assert.ok(!b.ok && b.status === 403 && /another device/.test(b.error));
});

test('bad input is rejected with clear errors', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, '', 1, 1);
  assert.equal(((await activate(st, S, 'EXAM-NOPE-NOPE-NOPE', 'device-phone-1')) as any).status, 404);
  assert.equal(((await activate(st, S, lic.key, { identifier: 'x' })) as any).status, 400);
  assert.equal(((await activate(st, S, '', 'device-phone-1')) as any).status, 400);
  assert.equal(((await activate(st, S, lic.key, 'short')) as any).status, 400);
});

test('tokens are bound to the device and cannot be forged or tampered with', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, '', 1, 1);
  const a = (await activate(st, S, lic.key, 'device-phone-1')) as { ok: true; token: string };
  const v = await verify(st, S, a.token, 'device-phone-1');
  assert.ok(v.ok && v.key === lic.key && v.owner === false);
  assert.ok(!(await verify(st, S, a.token, 'device-phone-2')).ok, 'token copied to another phone');
  assert.ok(!(await verify(st, 'other-secret', a.token, 'device-phone-1')).ok, 'wrong secret');
  assert.ok(!(await verify(st, S, a.token.slice(0, -2) + 'xx', 'device-phone-1')).ok, 'tampered');
  assert.ok(!(await verify(st, S, undefined, 'device-phone-1')).ok);
  assert.equal(readToken('garbage', S), null);
  assert.equal(readToken(a.token, ''), null, 'empty secret never validates');
});

test('revoke, restore and device reset', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, '', 1, 1);
  const a = (await activate(st, S, lic.key, 'device-phone-1')) as { ok: true; token: string };
  const l = (await st.get(lic.key))!;
  l.status = 'revoked'; await st.put(l);
  const v = await verify(st, S, a.token, 'device-phone-1');
  assert.ok(!v.ok && /revoked/.test(v.error));
  assert.ok(!(await activate(st, S, lic.key, 'device-phone-1')).ok, 'cannot re-activate while revoked');
  l.status = 'active'; await st.put(l);
  assert.ok((await verify(st, S, a.token, 'device-phone-1')).ok);
  l.devices = []; await st.put(l);
  assert.ok(!(await verify(st, S, a.token, 'device-phone-1')).ok, 'old phone is unbound after reset');
  assert.ok((await activate(st, S, lic.key, 'device-phone-2')).ok, 'new phone can take the slot');
});

test('a multi-device license (owner) allows up to its limit', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, 'Owner', 1, 3);
  for (const d of ['own-dev-001', 'own-dev-002', 'own-dev-003']) assert.ok((await activate(st, S, lic.key, d)).ok);
  assert.ok(!(await activate(st, S, lic.key, 'own-dev-004')).ok);
});

test('deleting a license cuts off its token immediately', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, '', 1, 1);
  const a = (await activate(st, S, lic.key, 'device-phone-1')) as { ok: true; token: string };
  await st.del(lic.key);
  assert.ok(!(await verify(st, S, a.token, 'device-phone-1')).ok);
});
