// Builds the same static app bundle and syncs it into the requested native Capacitor platform.
// The hosted Next.js website/API is not changed by this script.
//
// The export build does not depend on the repo's next.config.js: while it runs, every Next.js config file is
// set aside and a known-good export config is used instead, so a missing, renamed or edited config cannot
// stop the native app from being built. Everything is put back afterwards.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HIDE = ['app/api', 'app/admin', 'app/download'];
const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts'];
const EXPORT_CONFIG = "module.exports = { output: 'export', distDir: 'out', images: { unoptimized: true } };\n";
const STASH = '.export-hidden';
const platform = process.argv[2] || 'android';
const noSync = process.argv.includes('--no-sync');
if (!['android', 'ios'].includes(platform)) throw new Error(`Unsupported Capacitor target: ${platform}`);

// The app talks to your hosted site, and Next.js bakes that address into the app at build time. Read it the way
// "next build" will (process environment first, then .env.production.local, .env.local, .env.production, .env)
// and stop before building if it is missing, so an app that cannot reach the server is never produced.
try {
  const { default: nextEnv } = await import('@next/env');
  nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
} catch { /* only the process environment is available */ }
const apiUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
if (!/^https?:\/\/[^\s/]+/.test(apiUrl)) {
  throw new Error('NEXT_PUBLIC_API_URL is missing or is not a web address. The app needs it to reach your server. ' +
    'Set it to your deployed site, for example https://exam-mate-one.vercel.app, in .env.local on your computer, ' +
    'or as a Variable named NEXT_PUBLIC_API_URL in GitHub (Settings, Secrets and variables, Actions, Variables).');
}
process.env.NEXT_PUBLIC_API_URL = apiUrl;
console.log(`The app will talk to: ${apiUrl}`);

const bakedIn = (dir, text) => readdirSync(dir, { withFileTypes: true }).some((e) => {
  const p = `${dir}/${e.name}`;
  return e.isDirectory() ? bakedIn(p, text) : e.name.endsWith('.js') && readFileSync(p, 'utf8').includes(text);
});

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`"${cmd} ${args.join(' ')}" failed with exit code ${r.status ?? 'unknown'}`);
};

const moved = [];
try {
  mkdirSync(STASH, { recursive: true });
  for (const d of HIDE) {
    if (!existsSync(d)) continue;
    const to = `${STASH}/${d.replace('/', '__')}`;
    renameSync(d, to);
    moved.push([d, to]);
  }
  for (const f of NEXT_CONFIGS) {
    if (!existsSync(f)) continue;
    const to = `${STASH}/config__${f}`;
    renameSync(f, to);
    moved.push([f, to]);
  }
  writeFileSync('next.config.js', EXPORT_CONFIG);
  rmSync('out', { recursive: true, force: true });
  rmSync('.next/types', { recursive: true, force: true });
  run('npx', ['next', 'build'], { EXPORT: '1' });
} finally {
  rmSync('next.config.js', { force: true });
  for (const [d, to] of moved.reverse()) {
    if (existsSync(to)) renameSync(to, d);
  }
  rmSync(STASH, { recursive: true, force: true });
}

if (!existsSync('out/index.html')) {
  throw new Error('The static export did not create out/index.html. Check the "next build" output above for errors.');
}

if (!existsSync('out/_next') || !bakedIn('out/_next', apiUrl)) {
  throw new Error(`The app was built without the server address ${apiUrl}. Check NEXT_PUBLIC_API_URL and build again.`);
}

if (!noSync) {
  // Fail early, with a clear message, if the Capacitor config is not Exam Mate's.
  const configFile = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'].find(existsSync);
  const configText = configFile ? readFileSync(configFile, 'utf8') : '';
  if (!/webDir['"]?\s*:\s*['"]out['"]/.test(configText) || !configText.includes('com.exammate.app')) {
    throw new Error(`${configFile ?? 'capacitor.config.ts'} is not the Exam Mate Capacitor config. It must set appId 'com.exammate.app' and webDir 'out'. Restore it from the project and try again.`);
  }
  // A fresh iOS platform is generated only after the static web bundle exists.
  if (platform === 'ios' && !existsSync('ios/App')) run('npx', ['cap', 'add', 'ios']);
  run('npx', ['cap', 'sync', platform]);
  if (platform === 'android') {
    // TTS is the reader's core feature. Do not produce an APK if Capacitor
    // failed to wire its native implementation into the Android Gradle project.
    const settingsGradle = readFileSync('android/capacitor.settings.gradle', 'utf8');
    const appGradle = readFileSync('android/app/capacitor.build.gradle', 'utf8');
    if (!settingsGradle.includes("include ':capacitor-community-text-to-speech'") ||
        !appGradle.includes("implementation project(':capacitor-community-text-to-speech')")) {
      throw new Error('Android text-to-speech is not linked into the native project. Check @capacitor-community/text-to-speech installation, then run npm run cap:sync again. The APK was not built.');
    }
  }
  if (platform === 'ios') run('node', ['scripts/setup-ios.mjs']);
}
console.log(`\n${platform === 'ios' ? 'iOS' : 'Android'} bundle ready.`);
console.log(platform === 'ios' ? 'Open ios/App/App.xcworkspace in Xcode on macOS.' : 'Open the project with: npm run cap:open');
