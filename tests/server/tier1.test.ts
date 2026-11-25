import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, post } from './memory-store';
import { handleTransfer, handleValidate, handleVerify } from '../../server/license-api';
import { handleAnswer } from '../../server/answer';
import { applyTransfer, createLicenses, parseTransferResult, transfer, TRANSFER_COOLDOWN_MS, type License } from '../../server/license';
import { answerPrompt, parseQuestions, readPrompt, readSchema, resetModelCache } from '../../server/gemini';

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.TOKEN_SECRET = 'test-secret';
  process.env.ADMIN_PASSWORD = 'correct horse battery';
  resetModelCache();
});
afterEach(() => { globalThis.fetch = realFetch; });

const DAY = 24 * 60 * 60 * 1000;
const validate = (key: string, deviceId: string, ip = '1.2.3.4') =>
  post('/api/license/validate', { licenseKey: key, deviceId }, { 'x-forwarded-for': ip });
const move = (key: string, deviceId: string, ip = '1.2.3.4') =>
  post('/api/license/transfer', { licenseKey: key, deviceId }, { 'x-forwarded-for': ip });

/* ---------------- self-service device transfer ---------------- */
test('transfer: a key in use elsewhere offers a move, the move signs the old phone out', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, 'S', 1, 1);
  const first = await (await handleValidate(validate(lic.key, 'old-phone-0001'), st)).json();

  const refused = await handleValidate(validate(lic.key, 'new-phone-0002'), st);
  assert.equal(refused.status, 403);
  const body = await refused.json();
  assert.equal(body.code, 'in_use');
  assert.equal(body.canTransfer, true);

  const moved = await handleTransfer(move(lic.key, 'new-phone-0002'), st);
  assert.equal(moved.status, 200);
  const { token } = await moved.json();
  assert.equal((await handleVerify(post('/v', { token, deviceId: 'new-phone-0002' }), st)).status, 200, 'new phone works');

  const old = await handleVerify(post('/v', { token: first.token, deviceId: 'old-phone-0001' }), st);
  assert.equal(old.status, 403, 'old phone is signed out');
  assert.match((await old.json()).error, /moved to another phone/);
  assert.deepEqual((await st.get(lic.key))!.devices, ['new-phone-0002']);
});

test('transfer: only once per 30 days, and the app is told when it can move again', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, 'S', 1, 1);
  await handleValidate(validate(lic.key, 'phone-a-000001'), st);
  assert.equal((await handleTransfer(move(lic.key, 'phone-b-000002'), st)).status, 200);

  const again = await handleTransfer(move(lic.key, 'phone-c-000003'), st);
  assert.equal(again.status, 429);
  const body = await again.json();
  assert.equal(body.code, 'cooldown');
  assert.ok(Date.parse(body.retryAt) > Date.now() + 29 * DAY);

  const offer = await (await handleValidate(validate(lic.key, 'phone-c-000003'), st)).json();
  assert.equal(offer.canTransfer, false);
  assert.equal(offer.retryAt, body.retryAt);

  const later = await transfer(st, 'test-secret', lic.key, 'phone-c-000003', Date.now() + TRANSFER_COOLDOWN_MS + 1000);
  assert.equal(later.ok, true, 'allowed again after the cooldown');
});

test('transfer: the phone already on the key, a free slot, revoked and unknown keys', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, 'S', 1, 2);
  assert.equal((await handleTransfer(move(lic.key, 'phone-a-000001'), st)).status, 200, 'a free slot is used without a move');
  assert.equal((await st.get(lic.key))!.lastTransferMs, undefined, 'using a free slot does not start the cooldown');
  assert.equal((await handleTransfer(move(lic.key, 'phone-a-000001'), st)).status, 200, 'same phone again is fine');
  assert.equal((await handleTransfer(move('EXAM-NOPE-NOPE-NOPE', 'phone-a-000001'), st)).status, 404);
  const l = (await st.get(lic.key))!; l.status = 'revoked'; await st.put(l);
  assert.equal((await handleTransfer(move(lic.key, 'phone-z-000009'), st)).status, 403);
});

test('transfer: wrong keys count towards the same brute-force block as activation', async () => {
  const st = memoryStore();
  for (let i = 0; i < 15; i++) await handleTransfer(move(`EXAM-BAD${i}-XXXX-XXXX`, 'phone-a-000001', '9.9.9.9'), st);
  assert.equal((await handleTransfer(move('EXAM-ANY1-XXXX-XXXX', 'phone-a-000001', '9.9.9.9'), st)).status, 429);
});

test('applyTransfer on a two-phone key drops only the oldest phone', () => {
  const lic: License = { key: 'K', label: '', status: 'active', maxDevices: 2, devices: ['p1', 'p2'], createdAt: '' };
  const r = applyTransfer(lic, 'p3', 1_000_000);
  assert.equal(r.status, 'ok');
  assert.deepEqual(lic.devices, ['p2', 'p3']);
  assert.equal(lic.lastTransferMs, 1_000_000);
});

test('the atomic Redis transfer result is decoded strictly', () => {
  assert.deepEqual(parseTransferResult(['cooldown', '1234']), { status: 'cooldown', retryAtMs: 1234 });
  assert.deepEqual(parseTransferResult(['missing']), { status: 'missing' });
  assert.equal(parseTransferResult(['ok', JSON.stringify({ key: 'K', status: 'active', devices: ['d'], maxDevices: 1 })]).status, 'ok');
  assert.throws(() => parseTransferResult(['limit']));
  assert.throws(() => parseTransferResult(['cooldown', 'soon']));
});

/* ---------------- mark-aware answers ---------------- */
test('marks: the reader is asked for printed marks and keeps sensible values only', () => {
  assert.match(readPrompt, /marks: the number of marks printed/);
  assert.ok((readSchema as any).properties.questions.items.properties.marks);
  assert.deepEqual(parseQuestions(JSON.stringify({ questions: [
    { label: 'Q1', text: 'State two uses of email.', marks: 2 },
    { label: 'Q2', text: 'Explain one benefit.', marks: 0 },
    { label: 'Q3', text: 'Discuss.', marks: 999 },
    { label: 'Q4', text: 'Define RAM.' },
  ] })), [
    { label: 'Q1', text: 'State two uses of email.', marks: 2 },
    { label: 'Q2', text: 'Explain one benefit.' },
    { label: 'Q3', text: 'Discuss.' },
    { label: 'Q4', text: 'Define RAM.' },
  ]);
});

test('marks: each question in the answer prompt carries its marks so length follows them', () => {
  const p = answerPrompt('quick', [{ label: 'Q1', text: 'State two uses of email.', marks: 2 }, { label: 'Q2', text: 'Define RAM.', marks: 1 }, { label: 'Q3', text: 'Explain.' }]);
  assert.match(p, /^1\. \[Q1\] \(2 marks\) State two uses of email\.$/m);
  assert.match(p, /^2\. \[Q2\] \(1 mark\) Define RAM\.$/m);
  assert.match(p, /^3\. \[Q3\] Explain\.$/m);
  assert.match(p, /Marks, shown as "\(N marks\)" after a question, set the length/);
});

test('marks: the photo route passes the marks it read through to the answer call', async () => {
  const st = memoryStore();
  const [lic] = await createLicenses(st, 'S', 1, 1);
  const { token } = await (await handleValidate(validate(lic.key, 'device-phone-1'), st)).json();
  const prompts: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/models?')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }));
    const body = JSON.parse(String(init?.body));
    const text = String(body.contents[0].parts[0].text);
    const reply = (o: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }));
    if (text.includes('List every question')) return reply({ questions: [{ label: 'Question 1', text: 'Explain two uses of a database.', marks: 4 }] });
    prompts.push(text);
    return reply({ answers: [{ n: 1, lines: ['1. Schools store marks.', '2. Banks keep accounts.'] }] });
  }) as typeof fetch;
  const res = await handleAnswer(post('/api/answer', { images: ['data:image/jpeg;base64,/9j/4AAQ'], style: 'quick' }, {
    'x-license-token': token, 'x-device-id': 'device-phone-1', 'x-gemini-key': 'AIzaSyD-student-key-1234567890',
  }), st);
  assert.equal(res.status, 200);
  assert.match(prompts[0], /\[Question 1\] \(4 marks\) Explain two uses of a database\./);
});
