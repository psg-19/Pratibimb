/**
 * The live loop. Every second it checks the demo clock; when simulated time has moved on, it
 * advances each synthetic patient's true physiology, stores the new CGM readings, lets the
 * twin re-check its alerts and pushes updates to connected browsers. At 03:00 simulated time
 * every twin is re-fitted on the latest data, as the design describes.
 */
import { advanceTruth, generateRoutineDay, type SynthEvent, type TruthCheckpoint } from '../../shared/synth/generate';
import { PERSONAS } from '../../shared/synth/personas';
import { personaForNewPatient } from '../../shared/synth/template';
import type { PhysioParams } from '../../shared/physio/model';
import { istMidnight, minuteOfDayIST } from '../../shared/time';
import { insertEvent, rowToEvent, type EventRow } from '../db/db';
import type { TwinService } from './twin';

interface TruthRow {
  patient_id: string;
  params: string;
  checkpoint: string;
  seed: number;
  sensor_end: number | null;
}

export class LiveLoop {
  private timer: NodeJS.Timeout | null = null;
  private lastRefitDay: number | null = null;
  private busy = false;

  constructor(private twins: TwinService) {}

  start(intervalMs = 1000) {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Advances all synthetic patients to the current simulated time. */
  async tick() {
    if (this.busy || this.twins.resetting) return;
    this.busy = true;
    try {
      const { db, clock, bus } = this.twins;
      const now = clock.now();
      const target = now - (now % 5);
      const truths = db.prepare('SELECT * FROM truth').all() as TruthRow[];
      for (const tr of truths) {
        const cp = JSON.parse(tr.checkpoint) as TruthCheckpoint;
        if (target - cp.t < 5) continue;
        // Seed history contains only two future days. Extend the routine before advancing
        // physiology, otherwise a demo left running eventually has no meals or activity.
        const to = Math.min(target, cp.t + 6 * 60);
        const last = db.prepare("SELECT MAX(t) AS t FROM events WHERE patient_id = ? AND kind = 'sleep' AND source = 'device'").get(tr.patient_id) as { t: number | null };
        const patient = this.twins.patient(tr.patient_id)!;
        const persona = PERSONAS.find((p) => p.id === tr.patient_id) ?? personaForNewPatient({ id: patient.id, name: patient.name, medsLong: patient.meds_long });
        db.transaction(() => {
          for (let day = istMidnight(last.t ?? cp.t) + 1440; day <= istMidnight(to) + 1440; day += 1440) {
            for (const event of generateRoutineDay(persona, day, tr.seed)) insertEvent(db, tr.patient_id, event);
          }
        })();
        const params = JSON.parse(tr.params) as PhysioParams;
        const events = (db.prepare('SELECT * FROM events WHERE patient_id = ? AND t > ? AND t < ?').all(tr.patient_id, cp.t - 2 * 1440, target) as EventRow[]).map(
          rowToEvent,
        ) as SynthEvent[];
        // Cap a single catch-up step so a long pause or restart doesn't stall the loop.
        const res = advanceTruth(params, events, cp, to, tr.seed, tr.sensor_end);
        const collecting = this.twins.canBuild(tr.patient_id);
        const ins = db.prepare('INSERT OR IGNORE INTO readings (patient_id, t, mgdl) VALUES (?, ?, ?)');
        db.transaction(() => {
          if (collecting) for (const r of res.readings) ins.run(tr.patient_id, r.t, r.mgdl);
          db.prepare('UPDATE truth SET checkpoint = ? WHERE patient_id = ?').run(JSON.stringify(res.checkpoint), tr.patient_id);
        })();
        const latest = res.readings.at(-1);
        if (collecting && latest && latest.t > now - 10) {
          this.twins.touch(tr.patient_id);
          bus.publish({ type: 'reading', patientId: tr.patient_id, t: latest.t, mgdl: latest.mgdl });
          this.twins.evaluateAlerts(tr.patient_id);
        }
      }
      // Nightly re-fit at 03:00 simulated time.
      const day = istMidnight(now);
      // Keep the demo watch populated after midnight, as the demo clock continues running.
      for (const tr of truths) {
        db.prepare(`INSERT OR IGNORE INTO vitals (patient_id, day, steps, resting_hr)
          SELECT ?, ?, CAST(AVG(steps) AS INTEGER), CAST(AVG(resting_hr) AS INTEGER)
          FROM vitals WHERE patient_id = ? AND day >= ? AND day < ? HAVING COUNT(*) > 0`)
          .run(tr.patient_id, day, tr.patient_id, day - 7 * 1440, day);
      }
      if (minuteOfDayIST(now) >= 180 && minuteOfDayIST(now) < 240 && this.lastRefitDay !== day) {
        this.lastRefitDay = day;
        for (const p of this.twins.patients()) void this.twins.refit(p.id).catch(() => {});
      }
    } finally {
      this.busy = false;
    }
  }
}
