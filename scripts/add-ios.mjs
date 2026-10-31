import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['scripts/export.mjs', 'ios'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
