// Runs every *.test.ts under tests/ (works on Windows, macOS and Linux, any Node 20+).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.test.ts')) files.push(p);
  }
};
walk('tests');
const r = spawnSync('npx', ['--yes', 'tsx', '--test', ...files], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
