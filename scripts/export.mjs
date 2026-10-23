// Builds the static bundle for the Android app and copies it into the Android project.
// The Android app cannot contain server code, so app/api and app/admin are set aside during the build
// and always put back (even if the build fails).
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HIDE = ['app/api', 'app/admin', 'app/download'];
const STASH = '.export-hidden';

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`"${cmd} ${args.join(' ')}" failed`);
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
  rmSync('.next/types', { recursive: true, force: true }); // stale route types would point at the hidden folders
  run('npx', ['next', 'build'], { EXPORT: '1' });
} finally {
  for (const [d, to] of moved) renameSync(to, d);
  rmSync(STASH, { recursive: true, force: true });
}

if (!process.argv.includes('--no-sync')) run('npx', ['cap', 'sync', 'android']);
console.log('\nAndroid bundle ready. Open it with: npm run cap:open');
