import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, localDay, shouldPrompt, snoozeUpdate } from '../src/lib/update';
import { latestAppVersion, plainNotes, releasesRepo, resetAppVersionCache } from '../server/app-version';

const data = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => { data.set(k, String(v)); },
  removeItem: (k: string) => { data.delete(k); },
};
const realFetch = globalThis.fetch;
afterEach(() => { data.clear(); globalThis.fetch = realFetch; resetAppVersionCache(); });

test('versions compare numerically, not as text', () => {
  assert.equal(compareVersions('2.1.10', '2.1.9'), 1);
  assert.equal(compareVersions('2.1.9', '2.1.10'), -1);
  assert.equal(compareVersions('2.2', '2.1.99'), 1);
  assert.equal(compareVersions('2.1.0', '2.1'), 0);
});

test('localDay uses the phone calendar day', () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('"Later" hides the prompt for the rest of the day and it returns on the next day\'s first open', () => {
  assert.equal(shouldPrompt('2.2.0', false, '2026-11-25'), true, 'first time: shown');
  snoozeUpdate('2.2.0', '2026-11-25');
  assert.equal(shouldPrompt('2.2.0', false, '2026-11-25'), false, 'same day after Later: hidden');
  assert.equal(shouldPrompt('2.2.0', false, '2026-11-26'), true, 'next day: reminded');
  assert.equal(shouldPrompt('2.3.0', false, '2026-11-25'), true, 'an even newer release is shown at once');
  assert.equal(shouldPrompt('2.2.0', true, '2026-11-25'), true, 'a required update cannot be snoozed');
});

test('release repo comes from APP_RELEASES_REPO or the Vercel git repo, and rejects junk', () => {
  assert.equal(releasesRepo({ APP_RELEASES_REPO: 'me/releases' }), 'me/releases');
  assert.equal(releasesRepo({ VERCEL_GIT_REPO_OWNER: 'me', VERCEL_GIT_REPO_SLUG: 'ExamMate' }), 'me/ExamMate');
  assert.equal(releasesRepo({ APP_RELEASES_REPO: '../../evil?x' }), '');
  assert.equal(releasesRepo({}), '');
});

test('release notes become short plain text', () => {
  const notes = plainNotes("## What's Changed\n* Better answers by [me](https://x.y)\n**Full Changelog**: https://github.com/a/b/compare/v1...v2");
  assert.equal(notes, '• Better answers by me');
  assert.equal(plainNotes('### Fixes\n- Installs on more phones\n\nFile check: ExamMate.apk is 8734830 bytes.\nSHA-256: abc123'), 'Fixes\n• Installs on more phones', 'file-check lines are for the release page, not the prompt');
});

test('latest release: version from the tag, the ExamMate.apk asset, cached, optional minimum version', async () => {
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    calls++;
    assert.equal(String(url), 'https://api.github.com/repos/me/ExamMate/releases/latest');
    return new Response(JSON.stringify({
      tag_name: 'v2.1.11', body: 'Fixes', published_at: '2026-11-26T00:00:00Z',
      assets: [{ name: 'other.zip', browser_download_url: 'https://x/other.zip' }, { name: 'ExamMate.apk', browser_download_url: 'https://github.com/me/ExamMate/releases/download/v2.1.11/ExamMate.apk' }],
    }));
  }) as typeof fetch;
  const env = { APP_RELEASES_REPO: 'me/ExamMate', MIN_APP_VERSION: '2.1.0' };
  const v = await latestAppVersion(env, 1_000);
  assert.deepEqual(v, { version: '2.1.11', apkUrl: 'https://github.com/me/ExamMate/releases/download/v2.1.11/ExamMate.apk', notes: 'Fixes', minVersion: '2.1.0', publishedAt: '2026-11-26T00:00:00Z' });
  await latestAppVersion(env, 2_000);
  assert.equal(calls, 1, 'cached for five minutes');
});

test('latest release: a release without the APK, or GitHub failing, offers no update', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ tag_name: 'v2.1.11', assets: [] }))) as typeof fetch;
  assert.equal(await latestAppVersion({ APP_RELEASES_REPO: 'me/ExamMate' }), null);
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.equal(await latestAppVersion({ APP_RELEASES_REPO: 'me/ExamMate' }), null);
});

test('Android app can install updates through its own updater plugin', () => {
  const root = process.cwd();
  const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const activity = readFileSync(join(root, 'android/app/src/main/java/com/exammate/app/MainActivity.java'), 'utf8');
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(activity, /registerPlugin\(ExamMateUpdaterPlugin\.class\)/);
});

test('release APK is signed with v1, v2 and v3 so every phone installer accepts it', () => {
  const gradle = readFileSync(join(process.cwd(), 'android/app/build.gradle'), 'utf8');
  for (const scheme of ['V1', 'V2', 'V3']) assert.match(gradle, new RegExp(`enable${scheme}Signing = true`));
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/android-apk.yml'), 'utf8');
  assert.match(workflow, /apksigner" verify --verbose/);
  assert.doesNotMatch(workflow, /could not verify the signature"\s*$/m, 'a failed signature check must stop the release');
});
