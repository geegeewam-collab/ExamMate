import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { APK_NAME, handleUpdate, latestRelease, pickRelease, releasesRepo, resetUpdateCache } from '../../server/update';

const REPO = 'acme/exammate-downloads';
beforeEach(resetUpdateCache);

const apk = (over: object = {}) => ({ name: APK_NAME, state: 'uploaded', size: 12_345_678, browser_download_url: 'https://evil.example/x.apk', ...over });
const release = (over: object = {}) => ({
  tag_name: 'v1.0.1', draft: false, prerelease: false, published_at: '2026-10-24T08:00:00Z', html_url: 'https://evil.example/r', assets: [apk()], ...over,
});
const gh = (body: unknown, status = 200) => {
  const calls: { url: string; headers: Headers }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return Object.assign(fn, { calls });
};
const down = (() => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;

test('releasesRepo: RELEASES_REPO wins, Vercel git vars are the default, junk is refused', () => {
  assert.equal(releasesRepo({ RELEASES_REPO: REPO, VERCEL_GIT_REPO_OWNER: 'a', VERCEL_GIT_REPO_SLUG: 'b' }), REPO);
  assert.equal(releasesRepo({ VERCEL_GIT_REPO_OWNER: 'acme', VERCEL_GIT_REPO_SLUG: 'exammate' }), 'acme/exammate');
  assert.equal(releasesRepo({}), null);
  assert.equal(releasesRepo({ RELEASES_REPO: 'not a repo' }), null);
  assert.equal(releasesRepo({ RELEASES_REPO: 'a/b/../c' }), null);
  assert.equal(releasesRepo({ RELEASES_REPO: 'https://github.com/a/b' }), null);
});

test('pickRelease: a normal release gives the version and links built from the repo and tag', () => {
  const r = pickRelease(REPO, release())!;
  assert.equal(r.version, '1.0.1');
  assert.equal(r.apkUrl, `https://github.com/${REPO}/releases/download/v1.0.1/ExamMate.apk`);
  assert.equal(r.releaseUrl, `https://github.com/${REPO}/releases/tag/v1.0.1`);
  assert.equal(r.size, 12_345_678);
});

test('pickRelease: never trusts links inside the GitHub JSON', () => {
  const r = pickRelease(REPO, release())!;
  assert.ok(!JSON.stringify(r).includes('evil.example'));
});

test('pickRelease: drafts, pre-releases, odd tags and missing or unfinished APKs are not offered', () => {
  assert.equal(pickRelease(REPO, release({ draft: true })), null);
  assert.equal(pickRelease(REPO, release({ prerelease: true })), null);
  assert.equal(pickRelease(REPO, release({ tag_name: 'v1.0.1-beta' })), null);
  assert.equal(pickRelease(REPO, release({ tag_name: 'nightly' })), null);
  assert.equal(pickRelease(REPO, release({ assets: [] })), null);
  assert.equal(pickRelease(REPO, release({ assets: [apk({ name: 'other.apk' })] })), null);
  assert.equal(pickRelease(REPO, release({ assets: [apk({ state: 'starter' })] })), null, 'still uploading');
  assert.equal(pickRelease(REPO, release({ assets: undefined })), null);
  assert.equal(pickRelease(REPO, null), null);
  assert.equal(pickRelease(REPO, 'x'), null);
});

test('pickRelease: a bad size becomes null instead of breaking the answer', () => {
  assert.equal(pickRelease(REPO, release({ assets: [apk({ size: 'big' })] }))!.size, null);
  assert.equal(pickRelease(REPO, release({ assets: [apk({ size: 0 })] }))!.size, null);
});

test('latestRelease asks GitHub for the latest release of the right repo and then reuses the answer for 5 minutes', async () => {
  const f = gh(release());
  let t = 1_000_000;
  const a = await latestRelease(REPO, f, () => t);
  assert.equal(a!.version, '1.0.1');
  assert.equal(f.calls[0].url, `https://api.github.com/repos/${REPO}/releases/latest`);
  assert.match(f.calls[0].headers.get('accept')!, /github/);
  assert.ok(f.calls[0].headers.get('user-agent'), 'GitHub requires a User-Agent');
  t += 4 * 60_000;
  await latestRelease(REPO, f, () => t);
  assert.equal(f.calls.length, 1, 'cached');
  t += 2 * 60_000;
  await latestRelease(REPO, f, () => t);
  assert.equal(f.calls.length, 2, 'asked again after the cache expired');
});

test('latestRelease: a different repo never gets another repo\'s cached answer', async () => {
  await latestRelease(REPO, gh(release()));
  const other = gh(release({ tag_name: 'v9.0.0' }));
  assert.equal((await latestRelease('acme/other', other))!.version, '9.0.0');
  assert.equal(other.calls.length, 1);
});

test('latestRelease: simultaneous requests share one GitHub call', async () => {
  const f = gh(release());
  const all = await Promise.all([latestRelease(REPO, f), latestRelease(REPO, f), latestRelease(REPO, f)]);
  assert.equal(f.calls.length, 1);
  assert.ok(all.every((r) => r?.version === '1.0.1'));
});

test('latestRelease: 404 means no release yet (null), not an error', async () => {
  assert.equal(await latestRelease(REPO, gh({ message: 'Not Found' }, 404)), null);
});

test('latestRelease: when GitHub is down, an older answer is used; with none, it fails', async () => {
  await assert.rejects(() => latestRelease(REPO, down), /fetch failed/);
  let t = 1_000_000;
  await latestRelease(REPO, gh(release()), () => t);
  t += 10 * 60_000; // cache expired, GitHub now failing
  assert.equal((await latestRelease(REPO, down, () => t))!.version, '1.0.1');
  assert.equal((await latestRelease(REPO, gh({ message: 'rate limit' }, 403), () => t))!.version, '1.0.1');
  t += 25 * 60 * 60_000; // too old to trust
  await assert.rejects(() => latestRelease(REPO, down, () => t));
});

test('latestRelease: a rate-limit or server error from GitHub is an error, not "no update"', async () => {
  await assert.rejects(() => latestRelease(REPO, gh({ message: 'rate limited' }, 403)), /403/);
  resetUpdateCache();
  await assert.rejects(() => latestRelease(REPO, gh({}, 500)), /500/);
});

test('GET /api/update: success is shareable by the CDN, readable cross-origin, and has the app\'s shape', async () => {
  const res = await handleUpdate({ RELEASES_REPO: REPO }, gh(release()));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('cache-control')!, /s-maxage=300/);
  assert.match(res.headers.get('cache-control')!, /max-age=0/);
  const d = await res.json();
  assert.deepEqual(Object.keys(d.latest).sort(), ['apkUrl', 'publishedAt', 'releaseUrl', 'size', 'version']);
});

test('GET /api/update: no release yet is a normal answer with latest: null', async () => {
  const res = await handleUpdate({ RELEASES_REPO: REPO }, gh({ message: 'Not Found' }, 404));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { latest: null });
});

test('GET /api/update: failures are readable and are never cached', async () => {
  const off = await handleUpdate({}, gh(release()));
  assert.equal(off.status, 503);
  assert.equal((await off.json()).code, 'not_configured');
  assert.equal(off.headers.get('cache-control'), 'no-store');
  const bad = await handleUpdate({ RELEASES_REPO: REPO }, down);
  assert.equal(bad.status, 502);
  assert.equal((await bad.json()).code, 'upstream');
  assert.equal(bad.headers.get('cache-control'), 'no-store');
});
