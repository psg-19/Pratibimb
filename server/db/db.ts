import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SynthEvent } from '../../shared/synth/generate';

const here = dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));
  return db;
}

/* ---------- Row types ---------- */

export interface PatientRow {
  id: string;
  name: string;
  initials: string;
  age: number | null;
  years_t2d: number | null;
  city: string | null;
  language: 'en' | 'hi' | 'kn';
  pronoun: 'he' | 'she' | 'they';
  meds_short: string;
  meds_long: string;
  avatar: string;
  abha_suffix: string | null;
  synthetic: number;
  data_mode: 'synthetic' | 'imported' | 'empty';
  created_at_ms: number;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: 'patient' | 'clinician';
  patient_id: string | null;
}

export interface EventRow {
  id: number;
  patient_id: string;
  kind: SynthEvent['kind'];
  t: number;
  duration: number | null;
  carbs: number | null;
  true_carbs: number | null;
  speed: number | null;
  drug: string | null;
  dose: number | null;
  severity: number | null;
  steps: number | null;
  label: string | null;
  note: string | null;
  source: string | null;
  hidden: number;
  meta: string | null;
}

export interface AlertRow {
  id: number;
  patient_id: string;
  kind: 'predicted-low' | 'predicted-high' | 'cgm-low';
  issued_at: number;
  status: 'open' | 'snack' | 'team' | 'dismissed';
  handled_at: number | null;
  window_from: number | null;
  window_to: number | null;
  lowest: number | null;
  lowest_at: number | null;
  probability: number | null;
  drivers: string;
  snack_event_id: number | null;
}

/* ---------- Event conversion ---------- */

export function rowToEvent(r: EventRow): SynthEvent & { id: number } {
  const base = { id: r.id, t: r.t, source: (r.source ?? undefined) as SynthEvent['source'], hidden: !!r.hidden, note: r.note ?? undefined };
  switch (r.kind) {
    case 'meal':
      return { ...base, kind: 'meal', carbs: r.carbs ?? 0, trueCarbs: r.true_carbs ?? undefined, speed: r.speed ?? 1, label: r.label ?? undefined };
    case 'walk':
      return { ...base, kind: 'walk', duration: r.duration ?? 0, steps: r.steps ?? undefined };
    case 'med':
      return { ...base, kind: 'med', drug: r.drug as 'metformin', dose: r.dose ?? 0 };
    case 'sleep':
      return { ...base, kind: 'sleep', duration: r.duration ?? 0 };
    case 'illness':
      return { ...base, kind: 'illness', duration: r.duration ?? 0, severity: r.severity ?? 0.5, label: r.label ?? undefined };
  }
}

export function insertEvent(db: DB, patientId: string, e: SynthEvent, nowMs = Date.now()): number {
  const r = db
    .prepare(
      `INSERT INTO events (patient_id, kind, t, duration, carbs, true_carbs, speed, drug, dose, severity, steps, label, note, source, hidden, created_at_ms)
       VALUES (@patient_id, @kind, @t, @duration, @carbs, @true_carbs, @speed, @drug, @dose, @severity, @steps, @label, @note, @source, @hidden, @created)`,
    )
    .run({
      patient_id: patientId,
      kind: e.kind,
      t: e.t,
      duration: 'duration' in e ? e.duration : null,
      carbs: e.kind === 'meal' ? e.carbs : null,
      true_carbs: e.kind === 'meal' ? (e.trueCarbs ?? e.carbs) : null,
      speed: e.kind === 'meal' ? (e.speed ?? 1) : null,
      drug: e.kind === 'med' ? e.drug : null,
      dose: e.kind === 'med' ? e.dose : null,
      severity: e.kind === 'illness' ? e.severity : null,
      steps: e.kind === 'walk' ? (e.steps ?? null) : null,
      label: 'label' in e ? (e.label ?? null) : null,
      note: e.note ?? null,
      source: e.source ?? null,
      hidden: e.hidden ? 1 : 0,
      created: nowMs,
    });
  if (e.synthetic) db.prepare('UPDATE events SET meta = ? WHERE id = ?').run('{"synthetic":true}', r.lastInsertRowid);
  return Number(r.lastInsertRowid);
}

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
