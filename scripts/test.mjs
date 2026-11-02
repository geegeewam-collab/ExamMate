// Compile the TypeScript tests with the project's pinned TypeScript compiler, then run them with Node's test runner.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const tsc = resolve('node_modules/typescript/bin/tsc');
if (!existsSync(tsc)) {
  console.error('Project dependencies are missing. Run npm ci before running the test suite.');
  process.exit(1);
}
const outDir = resolve('.test-dist');
rmSync(outDir, { recursive: true, force: true });
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit', shell: false });
const compile = run([tsc, '-p', 'tsconfig.test.json']);
if (compile.status !== 0) { rmSync(outDir, { recursive: true, force: true }); process.exit(compile.status ?? 1); }

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (name.endsWith('.test.js')) files.push(file);
  }
};
try {
  walk(join(outDir, 'tests'));
  if (!files.length) throw new Error('No compiled test files were found.');
  const result = run(['--test', ...files]);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
