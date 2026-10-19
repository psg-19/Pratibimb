import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, [...(existsSync('.env') ? ['--env-file=.env'] : []), 'build/index.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
