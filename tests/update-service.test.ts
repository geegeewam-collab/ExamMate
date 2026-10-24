import test, { before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

type Svc = typeof import('../src/services/update-service');
let svc: Svc;
const g = globalThis as any;
const realFetch = globalThis.fetch;

before(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://exam-mate.example/'; // read once when the module loads
  svc = await import('../src/services/update-service');
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.NEXT_PUBLIC_APP_VERSION;
  delete g.window;
  delete g.localStorage;
});

const GOOD = {
  version: '1.0.2',
  apkUrl: 'https://github.com/acme/exammate/releases/download/v1.0.2/ExamMate.apk',
  releaseUrl: 'https://github.com/acme/exammate/releases/tag/v1.0.2',
  size: 9_000_000,
};
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const installed = (v?: string) => { if (v === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION; else process.env.NEXT_PUBLIC_APP_VERSION = v; };

test('installedVersion comes from the build and is normalised; unset or junk means "unknown"', () => {
  installed('1.0.1'); assert.equal(svc.installedVersion(), '1.0.1');
  installed('v1.2.3'); assert.equal(svc.installedVersion(), '1.2.3');
  installed('dev'); assert.equal(svc.installedVersion(), null);
  installed(undefined); assert.equal(svc.installedVersion(), null);
});

test('updatesSupported: only the installed app, with a known version', () => {
  installed('1.0.0');
  assert.equal(svc.updatesSupported(), false, 'a browser');
  g.window = { Capacitor: { isNativePlatform: () => true } };
  assert.equal(svc.updatesSupported(), true);
  installed(undefined);
  assert.equal(svc.updatesSupported(), false, 'no version baked in');
});

test('readLatest accepts a complete GitHub answer and rejects anything else', () => {
  assert.deepEqual(svc.readLatest(GOOD), { version: '1.0.2', apkUrl: GOOD.apkUrl, releaseUrl: GOOD.releaseUrl, size: 9_000_000 });
  assert.equal(svc.readLatest({ ...GOOD, size: 'x' })!.size, null);
  for (const bad of [
    null, 'x', {}, { ...GOOD, version: 'latest' },
    { ...GOOD, apkUrl: 'https://evil.example/ExamMate.apk' },
    { ...GOOD, apkUrl: 'http://github.com/acme/exammate/releases/download/v1.0.2/ExamMate.apk' },
    { ...GOOD, apkUrl: 'https://github.com.evil.example/a.apk' },
    { ...GOOD, apkUrl: 'https://user:pw@github.com/a.apk' },
    { ...GOOD, apkUrl: 'https://github.com:444/a.apk' },
    { ...GOOD, apkUrl: 'javascript:alert(1)' },
    { ...GOOD, apkUrl: 'intent://x#Intent;end' },
    { ...GOOD, releaseUrl: 'https://evil.example/r' },
    { ...GOOD, releaseUrl: undefined },
  ]) assert.equal(svc.readLatest(bad), null, JSON.stringify(bad));
});

test('checkForUpdate: a newer release is offered, an equal or older one is not', async () => {
  installed('1.0.1');
  globalThis.fetch = reply({ latest: GOOD });
  const r = await svc.checkForUpdate();
  assert.equal(r.state, 'available');
  if (r.state === 'available') assert.equal(r.update.version, '1.0.2');
  installed('1.0.2');
  assert.deepEqual(await svc.checkForUpdate(), { state: 'current' });
  installed('1.1.0');
  assert.deepEqual(await svc.checkForUpdate(), { state: 'current' });
});

test('checkForUpdate asks the configured server (no double slash) with a plain GET', async () => {
  installed('1.0.0');
  const seen: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify({ latest: null })); }) as typeof fetch;
  await svc.checkForUpdate();
  assert.equal(seen[0].url, 'https://exam-mate.example/api/update');
  assert.ok(!seen[0].init?.method || seen[0].init.method === 'GET');
  const h = new Headers(seen[0].init?.headers);
  assert.deepEqual([...h.keys()], ['accept'], 'only a CORS-safe header, so no preflight request is needed');
});

test('checkForUpdate: nothing published yet is "current"; every kind of failure is "failed", never a throw', async () => {
  installed('1.0.0');
  globalThis.fetch = reply({ latest: null });
  assert.deepEqual(await svc.checkForUpdate(), { state: 'current' });
  globalThis.fetch = reply({ code: 'upstream' }, 502);
  assert.deepEqual(await svc.checkForUpdate(), { state: 'failed' });
  globalThis.fetch = reply({ code: 'not_configured' }, 503);
  assert.deepEqual(await svc.checkForUpdate(), { state: 'failed' });
  globalThis.fetch = reply({ latest: { ...GOOD, apkUrl: 'https://evil.example/x.apk' } });
  assert.deepEqual(await svc.checkForUpdate(), { state: 'failed' }, 'unsafe link');
  globalThis.fetch = reply({ unexpected: true });
  assert.deepEqual(await svc.checkForUpdate(), { state: 'failed' });
  globalThis.fetch = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await svc.checkForUpdate(), { state: 'failed' }, 'not JSON');
  globalThis.fetch = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
  assert.deepEqual(await svc.checkForUpdate(), { state: 'failed' }, 'offline');
});

test('checkForUpdate gives up after the timeout instead of hanging', async () => {
  installed('1.0.0');
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as unknown as typeof fetch;
  const t0 = Date.now();
  assert.deepEqual(await svc.checkForUpdate(globalThis.fetch, 50), { state: 'failed' });
  assert.ok(Date.now() - t0 < 2000);
});

test('checkForUpdate does not call the server at all when the version is unknown', async () => {
  installed(undefined);
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
  assert.deepEqual(await svc.checkForUpdate(), { state: 'failed' });
  assert.equal(called, false);
});

test('snoozeStore keeps the reminder on the phone and ignores damaged data', () => {
  const data = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  assert.equal(svc.snoozeStore.get(), null);
  svc.snoozeStore.set({ version: '1.0.2', until: 123 });
  assert.deepEqual(svc.snoozeStore.get(), { version: '1.0.2', until: 123 });
  data.set('em_update_snooze', JSON.stringify({ version: 5, until: 'x' }));
  assert.equal(svc.snoozeStore.get(), null);
  data.set('em_update_snooze', '{not json');
  assert.equal(svc.snoozeStore.get(), null);
  svc.snoozeStore.set(null);
  assert.equal(data.has('em_update_snooze'), false);
});
