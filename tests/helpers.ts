import type { GoogleGenAI } from '@google/genai';
import { AiService } from '../server/ai/client';
import { buildApp } from '../server/app';
import { config } from '../server/config';
import { openDb } from '../server/db/db';
import { seed } from '../server/db/seed';
import { Bus } from '../server/services/bus';
import { Clock } from '../server/services/clock';
import { FitPool } from '../server/services/fitPool';
import { LiveLoop } from '../server/services/live';
import { TwinService } from '../server/services/twin';

/** A full app on an in-memory database with a controllable wall clock. Twins fit inline. */
export async function createTestApp(opts: { ai?: GoogleGenAI | null; only?: string[] } = {}) {
  let wallMs = 1_800_000_000_000;
  const db = openDb(':memory:');
  const clock = new Clock(db, config.demoStart, 15, () => wallMs);
  const bus = new Bus();
  const twins = new TwinService(db, clock, bus, new FitPool(0));
  clock.set({ to: config.demoStart, paused: true });
  await seed(db, twins, () => {}, opts.only ?? ['suresh', 'arjun']);
  clock.set({ paused: false, speed: 15 });
  const ai = new AiService(twins, opts.ai ?? null);
  const app = await buildApp({ db, clock, bus, twins, ai });
  const live = new LiveLoop(twins);

  async function login(email: string, password = 'pratibimb') {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : (set ?? '');
    return { status: res.statusCode, cookie: raw.split(';')[0] };
  }

  return {
    app,
    db,
    clock,
    twins,
    live,
    login,
    /** Moves real (wall) time forward; at 15× each 20 s is 5 simulated minutes. */
    advance: (ms: number) => {
      wallMs += ms;
    },
  };
}

/** A multipart body with one file; plain `fields` go first, so the server sees them with the file. */
export function multipart(field: string, filename: string, type: string, content: string | Buffer, fields: Record<string, string> = {}) {
  const boundary = '----pratibimbtest';
  const body = Buffer.concat([
    ...Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
