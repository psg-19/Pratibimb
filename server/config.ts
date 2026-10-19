import { resolve } from 'node:path';
import { istTime } from '../shared/time';

function demoStart(): number {
  const s = process.env.DEMO_START;
  if (!s) return istTime(2026, 10, 13, 21, 40);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error('DEMO_START must look like 2026-10-13T21:40 (IST)');
  return istTime(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dbFile: process.env.DB_FILE ?? resolve(process.cwd(), 'data/pratibimb.db'),
  /** Simulated time the demo starts at (IST). */
  demoStart: demoStart(),
  /** Simulated minutes per real minute (15× → a new 5-minute reading every 20 s). */
  demoSpeed: Number(process.env.DEMO_SPEED ?? 15),
  production: process.env.NODE_ENV === 'production',
  /** Secure cookies need HTTPS; defaults on in production unless COOKIE_SECURE=false (plain-HTTP demos). */
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  staticDir: resolve(process.cwd(), 'dist'),
  /** Gemini model for all AI features. */
  aiModel: process.env.AI_MODEL || 'gemini-3.8-flash',
  aiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  aiEnabled: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  sessionDays: 14,
};
