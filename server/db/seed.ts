/**
 * Seeds the demo: one clinician, six synthetic patients with 21 days of history and their
 * fitted twins. Runs once on an empty database (or with `npm run seed -- --reset`).
 */
import { randomUUID } from 'node:crypto';
import { PERSONAS } from '../../shared/synth/personas';
import { generateHistory } from '../../shared/synth/generate';
import { hashSeed } from '../../shared/rng';
import { istMidnight } from '../../shared/time';
import { hashPassword } from '../auth';
import { insertEvent, type DB } from './db';
import type { TwinService } from '../services/twin';

export const DEMO_PASSWORD = 'pratibimb';
export const CLINICIAN_EMAIL = 'doctor@pratibimb.demo';

const PRONOUN: Record<string, 'he' | 'she'> = { suresh: 'he', arjun: 'he', lakshmi: 'she', meera: 'she', fatima: 'she', imran: 'he' };

export function isSeeded(db: DB) {
  return (db.prepare('SELECT COUNT(*) AS n FROM patients').get() as { n: number }).n > 0;
}

/** Removes all demo data (patients cascade to their readings, events, twins, alerts…). */
export function resetDb(db: DB) {
  db.exec(`DELETE FROM sessions; DELETE FROM users; DELETE FROM patients;`);
}

export async function seed(db: DB, twins: TwinService, log: (m: string) => void = () => {}, only?: readonly string[]) {
  const now = twins.clock.now();
  const created = Date.now();
  const pw = hashPassword(DEMO_PASSWORD);
  db.prepare('INSERT INTO users (id, email, name, password_hash, role, patient_id, created_at_ms) VALUES (?, ?, ?, ?, ?, NULL, ?)').run(
    randomUUID(),
    CLINICIAN_EMAIL,
    'Dr. [CLINICIAN NAME]',
    pw,
    'clinician',
    created,
  );

  const personas = PERSONAS.filter((p) => !only || only.includes(p.id));
  for (const [i, p] of personas.entries()) {
    const t0 = Date.now();
    const h = generateHistory(p, now);
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO patients (id, name, initials, age, years_t2d, city, language, pronoun, meds_short, meds_long, avatar, abha_suffix, synthetic, data_mode, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'synthetic', ?)`,
      ).run(p.id, p.name, p.initials, p.age, p.yearsT2D, p.city, p.language, PRONOUN[p.id] ?? 'they', p.medsShort, p.medsLong, p.avatar, p.abhaSuffix, created + i);
      db.prepare('INSERT INTO users (id, email, name, password_hash, role, patient_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        p.email,
        p.name,
        pw,
        'patient',
        p.id,
        created,
      );
      db.prepare('INSERT INTO truth (patient_id, params, checkpoint, seed, sensor_end) VALUES (?, ?, ?, ?, ?)').run(
        p.id,
        JSON.stringify(h.params),
        JSON.stringify(h.checkpoint),
        hashSeed(p.id),
        h.sensorEnd,
      );
      for (const e of h.events) insertEvent(db, p.id, e, created);
      const ins = db.prepare('INSERT INTO readings (patient_id, t, mgdl) VALUES (?, ?, ?)');
      for (const r of h.readings) ins.run(p.id, r.t, r.mgdl);
      const vit = db.prepare('INSERT INTO vitals (patient_id, day, steps, resting_hr) VALUES (?, ?, ?, ?)');
      for (const v of h.vitals) vit.run(p.id, v.day, v.steps, v.restingHr);
      const rec = db.prepare('INSERT INTO records (patient_id, date, kind, name, value, unit, detail, source, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const l of p.labs) rec.run(p.id, l.date, 'lab', l.test, l.value, l.unit, null, l.source, created);
      for (const m of p.medsLong.split(', ')) {
        const [name, ...rest] = m.split(' ');
        rec.run(p.id, p.labs.at(-1)?.date ?? '2026-07-01', 'medication', name, null, null, rest.join(' '), 'Synthetic prescription (ABHA)', created);
      }
      const src = db.prepare('INSERT INTO sources (patient_id, source, connected, meta, updated_at_ms) VALUES (?, ?, ?, ?, ?)');
      for (const [s, on] of Object.entries(p.sources)) src.run(p.id, s, on ? 1 : 0, null, created);
      const con = db.prepare('INSERT INTO consents (patient_id, consent, granted, updated_at_ms) VALUES (?, ?, ?, ?)');
      con.run(p.id, 'build', 1, created);
      con.run(p.id, 'care', 1, created);
      con.run(p.id, 'research', 0, created);
    });
    tx();
    log(`  ${p.name}: ${h.readings.length} readings, ${h.events.length} events (${Date.now() - t0} ms)`);
  }

  // Twins are fitted as of 03:00 on the demo day, as the nightly refit would have done.
  log('Fitting twins…');
  const t1 = Date.now();
  const fitAt = istMidnight(now) + 180;
  await Promise.all(personas.map((p) => twins.refit(p.id, fitAt)));
  log(`  ${personas.length} twins fitted in ${((Date.now() - t1) / 1000).toFixed(1)} s`);

  for (const p of personas) twins.evaluateAlerts(p.id);
  const night = twins.nightKey(now);
  for (const id of ['fatima', 'imran'].filter((x) => personas.some((p) => p.id === x))) {
    db.prepare('INSERT INTO reviews (patient_id, night, status, note, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, night, 'reviewed', 'Marked reviewed', now - 30);
  }
}
