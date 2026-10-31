// Builds the same static app bundle and syncs it into the requested native Capacitor platform.
// The hosted Next.js website/API is not changed by this script.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HIDE = ['app/api', 'app/admin', 'app/download'];
const STASH = '.export-hidden';
const platform = process.argv[2] || 'android';
const noSync = process.argv.includes('--no-sync');
if (!['android', 'ios'].includes(platform)) throw new Error(`Unsupported Capacitor target: ${platform}`);

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
  rmSync('.next/types', { recursive: true, force: true });
  run('npx', ['next', 'build'], { EXPORT: '1' });
} finally {
  for (const [d, to] of moved.reverse()) {
    if (existsSync(to)) renameSync(to, d);
  }
  rmSync(STASH, { recursive: true, force: true });
}

if (!noSync) {
  // A fresh iOS platform is generated only after the static web bundle exists.
  if (platform === 'ios' && !existsSync('ios/App')) run('npx', ['cap', 'add', 'ios']);
  run('npx', ['cap', 'sync', platform]);
  if (platform === 'ios') run('node', ['scripts/setup-ios.mjs']);
}
console.log(`\n${platform === 'ios' ? 'iOS' : 'Android'} bundle ready.`);
console.log(platform === 'ios' ? 'Open ios/App/App.xcworkspace in Xcode on macOS.' : 'Open the project with: npm run cap:open');
