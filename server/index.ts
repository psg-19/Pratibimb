/** Starts the Pratibimb API: opens the database, seeds the demo on first run and serves the app. */
import { AiService } from './ai/client';
import { buildApp } from './app';
import { config } from './config';
import { openDb } from './db/db';
import { CLINICIAN_EMAIL, DEMO_PASSWORD, isSeeded, resetDb, seed } from './db/seed';
import { Bus } from './services/bus';
import { Clock } from './services/clock';
import { FitPool } from './services/fitPool';
import { LiveLoop } from './services/live';
import { TwinService } from './services/twin';

async function main() {
  const db = openDb(config.dbFile);
  if (process.argv.includes('--reset')) resetDb(db);
  const clock = new Clock(db, config.demoStart, config.demoSpeed);
  const bus = new Bus();
  const pool = new FitPool();
  const twins = new TwinService(db, clock, bus, pool);
  const ai = new AiService(twins);

  if (!isSeeded(db)) {
    clock.set({ to: config.demoStart, paused: true });
    console.log('Seeding the demo (six synthetic patients, 21 days each)…');
    await seed(db, twins, (m) => console.log(m));
    clock.set({ paused: false, speed: config.demoSpeed });
    console.log(`Demo accounts: ${CLINICIAN_EMAIL} (care team), suresh@pratibimb.demo (patient) — password "${DEMO_PASSWORD}"`);
  } else {
    // Treat downtime as a pause: resume simulated time where the synthetic sensors stopped.
    const last = db.prepare(`SELECT MAX(json_extract(checkpoint, '$.t')) AS t FROM truth`).get() as { t: number | null };
    if (last.t && clock.now() - last.t > 30) clock.set({ to: last.t });
  }

  const live = new LiveLoop(twins);
  live.start();
  const app = await buildApp({ db, clock, bus, twins, ai }, { logger: !process.env.QUIET, serveStatic: config.production });
  await app.listen({ port: config.port, host: config.host });
  console.log(`Pratibimb API on http://${config.host}:${config.port} · AI ${ai.enabled ? `on (${config.aiModel})` : 'off — set GEMINI_API_KEY to enable'}`);

  const shutdown = async () => {
    live.stop();
    await app.close();
    await pool.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
