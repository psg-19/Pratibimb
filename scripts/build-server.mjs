import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['server/index.ts', 'server/twinWorker.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  outdir: 'build',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" },
});
await copyFile('server/db/schema.sql', 'build/schema.sql');
