// Runs the API in watch mode, loading .env when present (so GEMINI_API_KEY never needs to be typed).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = ['tsx', 'watch', '--clear-screen=false', ...(existsSync('.env') ? ['--env-file=.env'] : []), 'server/index.ts'];
const child = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
