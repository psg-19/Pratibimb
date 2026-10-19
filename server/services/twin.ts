/**
 * Twin service: reads a patient's data, runs the twin engine and shapes results for the API.
 * Forecasts are cached until the next reading or event change.
 */
import type {
  AlertDTO,
  CarePatientDTO,
  ForecastDTO,
  Latest,
  OutlookDTO,
  PatientSummary,
  TimelineItem,
  TodayDTO,
  TwinSummaryDTO,
  WhatIfDTO,
  WhatIfRequest,
} from '../../shared/api';
import type { TwinEvent } from '../../shared/physio/events';
import type { PhysioParams } from '../../shared/physio/model';
import { clockIST, formatDuration, istMidnight, minuteOfDayIST } from '../../shared/time';
import type { Calibration } from '../../shared/twin/calibrate';
import { attributeDrivers, type Driver } from '../../shared/twin/drivers';
import type { FitKey, Observation } from '../../shared/twin/fit';
import { forecast, type Forecast } from '../../shared/twin/forecast';
import type { Insight } from '../../shared/twin/insights';
import { gmiFromReadings, projectGmi } from '../../shared/twin/outlook';
import type { TwinModelData } from '../../shared/twin/pipeline';
import { mealSlot, type LearnedRoutine } from '../../shared/twin/routine';
import { assessRisk, type Risk } from '../../shared/twin/triage';
import { simulateEvening, verdict } from '../../shared/twin/whatif';
import { json, rowToEvent, insertEvent, type AlertRow, type DB, type EventRow, type PatientRow } from '../db/db';
import type { Bus } from './bus';
import type { Clock } from './clock';
import type { FitPool } from './fitPool';

export interface StoredTwin {
  params: PhysioParams;
  logSd: Record<FitKey, number>;
  fit: TwinModelData['fit'];
  calibration: Calibration;
  routine: LearnedRoutine;
  insights: Insight[];
  fittedAt: number;
}

const CHART_BACK = 360;
const DRUG = { metformin: 'Metformin', glimepiride: 'Glimepiride', sitagliptin: 'Sitagliptin' } as Record<string, string>;
const POSS = { he: 'his', she: 'her', they: 'their' } as const;
const OBJ = { he: 'him', she: 'her', they: 'them' } as const;

export function patientSummary(p: PatientRow, hasTwin: boolean): PatientSummary {
  return {
    id: p.id,
    name: p.name,
    firstName: p.name.split(' ')[0],
    initials: p.initials,
    age: p.age,
    yearsT2D: p.years_t2d,
    city: p.city,
    language: p.language,
    pronoun: p.pronoun,
    medsShort: p.meds_short,
    medsLong: p.meds_long,
    avatar: p.avatar,
    abhaSuffix: p.abha_suffix,
    dataMode: p.data_mode,
    synthetic: !!p.synthetic,
    hasTwin,
  };
}

export class TwinService {
  private cache = new Map<string, unknown>();
  /** True while the demo is being reseeded (the live loop pauses). */
  resetting = false;
  private versions = new Map<string, number>();
  private refitting = new Set<string>();

  constructor(
    readonly db: DB,
    readonly clock: Clock,
    readonly bus: Bus,
    private pool: FitPool,
  ) {}

  /* ---------------- data access ---------------- */

  patient(id: string): PatientRow | undefined {
    return this.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as PatientRow | undefined;
  }

  patients(): PatientRow[] {
    return this.db.prepare('SELECT * FROM patients ORDER BY created_at_ms, name').all() as PatientRow[];
  }

  summary(id: string): PatientSummary | null {
    const p = this.patient(id);
    return p ? patientSummary(p, !!this.twin(id)) : null;
  }

  twin(id: string): StoredTwin | null {
    if (!this.canBuild(id)) return null;
    const r = this.db.prepare('SELECT * FROM twins WHERE patient_id = ?').get(id) as
      | { params: string; log_sd: string; fit: string; calibration: string; routine: string; insights: string; fitted_at: number }
      | undefined;
    if (!r) return null;
    return {
      params: JSON.parse(r.params),
      logSd: JSON.parse(r.log_sd),
      fit: JSON.parse(r.fit),
      calibration: JSON.parse(r.calibration),
      routine: JSON.parse(r.routine),
      insights: JSON.parse(r.insights),
      fittedAt: r.fitted_at,
    };
  }

  touchAll() {
    this.cache.clear();
    this.versions.clear();
  }

  /** Bumps the cache version after any data change. */
  touch(id: string) {
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
  }

  private key(id: string, ...parts: (string | number)[]) {
    const last = this.latestReading(id)?.t ?? 0;
    return [id, this.versions.get(id) ?? 0, last, this.clock.now() >> 3, ...parts].join('|');
  }

  private memo<T>(key: string, fn: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const v = fn();
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, v);
    return v;
  }

  readings(id: string, from: number, to: number): Observation[] {
    return this.db.prepare('SELECT t, mgdl FROM readings WHERE patient_id = ? AND t > ? AND t <= ? ORDER BY t').all(id, from, to) as Observation[];
  }

  latestReading(id: string): Observation | undefined {
    return this.db
      .prepare('SELECT t, mgdl FROM readings WHERE patient_id = ? AND t <= ? ORDER BY t DESC LIMIT 1')
      .get(id, this.clock.now()) as Observation | undefined;
  }

  /** Events the twin may know about: logged, device and inferred events up to now, plus confirmed plans. */
  visibleEvents(id: string, opts: { from?: number; includePlans?: boolean } = {}) {
    const now = this.clock.now();
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE patient_id = ? AND hidden = 0 AND t >= ? AND (t <= ? OR (? AND source = 'suggested')) ORDER BY t`,
      )
      .all(id, opts.from ?? 0, now, opts.includePlans ? 1 : 0) as EventRow[];
    // The twin only sees streams the patient has connected and consented to.
    const src = this.sourceFlags(id);
    return rows
      .filter((r) => {
        if (r.kind === 'meal' && r.source !== 'inferred' && r.source !== 'suggested') return src.meals;
        if ((r.kind === 'walk' || r.kind === 'sleep') && r.source === 'device') return src.watch;
        return true;
      })
      .map(rowToEvent);
  }

  /* ---------------- fitting ---------------- */

  canBuild(id: string): boolean {
    return !!this.sourceFlags(id).cgm && !!this.db.prepare("SELECT 1 FROM consents WHERE patient_id = ? AND consent = 'build' AND granted = 1").get(id);
  }

  isRefitting(id: string) {
    return this.refitting.has(id);
  }

  /** Fits the twin on data up to `at` (default: now). The seed uses 03:00 on the demo day, like a nightly refit. */
  async refit(id: string, at?: number): Promise<StoredTwin | null> {
    if (this.refitting.has(id) || !this.canBuild(id)) return null;
    const p = this.patient(id);
    if (!p) return null;
    const now = at ?? this.clock.now();
    const readings = this.readings(id, now - 15 * 1440, now);
    if (readings.length < 288) return null;
    this.refitting.add(id);
    try {
      const events = this.visibleEvents(id, { from: now - 16 * 1440 }).filter((e) => e.source !== 'inferred' && e.t <= now);
      const prev = this.twin(id);
      const result = await this.pool.build({ events, readings, now, previous: prev?.params, pronoun: p.pronoun });
      if (!this.canBuild(id) || !this.patient(id)) return null;
      this.storeTwin(id, result, now);
      this.bus.publish({ type: 'twin', patientId: id, fittedAt: now });
      return this.twin(id);
    } finally {
      this.refitting.delete(id);
    }
  }

  storeTwin(id: string, r: TwinModelData, fittedAt: number) {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO twins (patient_id, params, log_sd, fit, calibration, routine, insights, fitted_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(patient_id) DO UPDATE SET params = excluded.params, log_sd = excluded.log_sd, fit = excluded.fit,
             calibration = excluded.calibration, routine = excluded.routine, insights = excluded.insights,
             fitted_at = excluded.fitted_at, version = twins.version + 1`,
        )
        .run(id, JSON.stringify(r.params), JSON.stringify(r.logSd), JSON.stringify(r.fit), JSON.stringify(r.calibration), JSON.stringify(r.routine), JSON.stringify(r.insights), fittedAt);
      // Replace inferred meals in the fitted window with the new detections.
      this.db.prepare(`DELETE FROM events WHERE patient_id = ? AND source = 'inferred' AND t >= ? AND t <= ?`).run(id, r.fit.from, r.fit.to);
      for (const m of r.inferred) insertEvent(this.db, id, m);
    });
    tx();
    this.touch(id);
  }

  /* ---------------- forecasts ---------------- */

  private runForecast(id: string, horizon: number, withPlans: boolean): Forecast | null {
    const tw = this.twin(id);
    if (!tw) return null;
    const now = this.clock.now();
    const readings = this.readings(id, now - 2 * 1440, now);
    if (readings.length < 12) return null;
    const events = this.visibleEvents(id, { from: now - 3 * 1440, includePlans: withPlans });
    return forecast({ params: tw.params, logSd: tw.logSd, events, readings, now, horizon, routine: tw.routine, calibration: tw.calibration, seed: now });
  }

  forecastRaw(id: string, horizon: number, withPlans = false): Forecast | null {
    return this.memo(this.key(id, 'fc', horizon, withPlans ? 1 : 0), () => this.runForecast(id, horizon, withPlans));
  }

  plannedSnack(id: string) {
    const now = this.clock.now();
    return this.db
      .prepare(`SELECT * FROM events WHERE patient_id = ? AND source = 'suggested' AND t > ? ORDER BY t LIMIT 1`)
      .get(id, now) as EventRow | undefined;
  }

  latest(id: string): Latest | null {
    const now = this.clock.now();
    const rs = this.readings(id, now - 30, now);
    const last = rs.at(-1);
    if (!last || now - last.t > 60) return null;
    const ref = rs.find((r) => last.t - r.t >= 15) ?? rs[0];
    const slope = last.t > ref.t ? (last.mgdl - ref.mgdl) / (last.t - ref.t) : 0;
    const trend: Latest['trend'] = slope <= -0.4 ? 'falling' : slope >= 0.4 ? 'rising' : 'steady';
    const recent = this.visibleEvents(id, { from: now - 150 });
    const walk = [...recent].reverse().find((e) => e.kind === 'walk' && e.t + e.duration >= now - 75);
    const meal = [...recent].reverse().find((e) => e.kind === 'meal' && e.t >= now - 120 && e.source !== 'inferred');
    const slot = meal ? mealSlot(minuteOfDayIST(meal.t)) : null;
    const after = walk ? (meal && slot === 'dinner' && walk.t - meal.t <= 90 ? 'after dinner walk' : 'after a walk') : meal ? `after ${slot ?? 'a meal'}` : '';
    return { t: last.t, mgdl: last.mgdl, trend, note: after ? `${trend}, ${after}` : trend };
  }

  forecastDTO(id: string, horizon: number): ForecastDTO | null {
    const tw = this.twin(id);
    const base = this.forecastRaw(id, horizon, false);
    if (!tw || !base) return null;
    const now = this.clock.now();
    const snack = this.plannedSnack(id);
    const withSnack = snack ? this.forecastRaw(id, horizon, true) : null;
    const inEffect = withSnack ?? base;
    const from = now - CHART_BACK;
    const measured = this.readings(id, from - 5, now).map((r) => ({ t: r.t, v: r.mgdl }));
    const events = this.visibleEvents(id, { from: from - 60, includePlans: true });
    const meals = [
      ...events
        .filter((e) => e.kind === 'meal' && e.t >= from && e.source !== 'inferred')
        .map((e) => ({ t: e.t, label: `${mealName(e)} · ${clockIST(e.t)}`, compact: mealName(e), planned: e.t > now })),
      ...base.expected
        .filter((e) => e.kind === 'meal')
        .map((e) => ({ t: e.t, label: `${e.kind === 'meal' ? e.label : 'Meal'} · ${clockIST(e.t)}`, compact: 'Usual', planned: true })),
    ];
    const walks = events
      .filter((e) => e.kind === 'walk' && e.t + e.duration >= from)
      .map((e) => ({ from: e.t, to: e.t + (e.kind === 'walk' ? e.duration : 0), label: `Walk · ${e.kind === 'walk' ? e.duration : 0} min` }));
    let sleep: ForecastDTO['sleep'] = null;
    if (tw.routine.sleepAt != null && tw.routine.sleepHours != null) {
      let s = istMidnight(now) + tw.routine.sleepAt;
      if (s + tw.routine.sleepHours * 60 < now) s += 1440;
      if (s - now > 18 * 60) s -= 1440;
      const e = s + Math.round(tw.routine.sleepHours * 60);
      sleep = { from: s, to: e, label: `Usual sleep ${clockIST(s)}–${clockIST(e)}` };
    }
    const latest = this.latestReading(id);
    const lead = Math.min(horizon, 240);
    const bucket = Math.min(tw.calibration.mae.length - 1, Math.floor(lead / 30));
    return {
      patientId: id,
      now,
      horizon,
      from,
      end: now + horizon,
      measured,
      median: base.median,
      band: base.band,
      scenario: withSnack ? withSnack.median : null,
      readout: { lowest: inEffect.lowest, inRangePct: inEffect.inRangePct, pLow: inEffect.pLow },
      riskWindow: withSnack ? null : base.riskWindow,
      meals,
      walks,
      sleep,
      latest: this.latest(id),
      lastReadingAgoSec: latest ? Math.round(this.clock.wallSeconds(this.clock.exact() - latest.t)) : null,
      trackRecordMae: bucket >= 0 ? (tw.calibration.mae[bucket] ?? null) : null,
    };
  }

  /* ---------------- risk & explanation ---------------- */

  riskAndDrivers(id: string): { risk: Risk; drivers: Driver[]; forecast: Forecast } | null {
    return this.memo(this.key(id, 'risk'), () => {
      const tw = this.twin(id);
      const fc = this.forecastRaw(id, 360, false);
      const p = this.patient(id);
      if (!tw || !fc || !p) return null;
      const risk = assessRisk(fc);
      const now = this.clock.now();
      const drivers =
        risk.kind === 'stable'
          ? []
          : attributeDrivers({
              params: tw.params,
              events: this.visibleEvents(id, { from: now - 5 * 1440 }),
              readings: this.readings(id, now - 2 * 1440, now),
              routine: tw.routine,
              now,
              direction: risk.kind,
              pronoun: p.pronoun,
              firstDoses: this.firstDoses(id),
            });
      return { risk, drivers, forecast: fc };
    });
  }

  firstDoses(id: string): Record<string, number> {
    const rows = this.db.prepare(`SELECT drug, MIN(t) AS t FROM events WHERE patient_id = ? AND kind = 'med' AND hidden = 0 GROUP BY drug`).all(id) as { drug: string; t: number }[];
    return Object.fromEntries(rows.map((r) => [r.drug, r.t]));
  }

  facts(id: string): string[] {
    const now = this.clock.now();
    const out: string[] = [];
    const p = this.patient(id);
    const truth = this.db.prepare('SELECT sensor_end FROM truth WHERE patient_id = ?').get(id) as { sensor_end: number | null } | undefined;
    if (truth?.sensor_end && truth.sensor_end > now && truth.sensor_end - now < 24 * 60) {
      out.push(`Sensor expires at ${clockIST(truth.sensor_end)} — forecasts stop after that`);
    }
    const recent = this.readings(id, now - 180, now);
    const high = recent.filter((r) => r.mgdl > 250);
    if (high.length >= 2) out.push(`${high.length === 2 ? 'Two' : high.length} readings above 250 since ${clockIST(high[0].t)}`);
    const week = this.readings(id, now - 7 * 1440, now);
    if (week.length > 288) {
      const tir = Math.round((100 * week.filter((r) => r.mgdl >= 70 && r.mgdl <= 180).length) / week.length);
      if (tir >= 80) out.push(`${tir}% time in range this week`);
    }
    const ev = this.visibleEvents(id, { from: now - 14 * 1440 });
    const firstByDrug = new Map<string, number>();
    for (const e of ev) if (e.kind === 'med' && !firstByDrug.has(e.drug)) firstByDrug.set(e.drug, e.t);
    const allFirst = this.db.prepare(`SELECT drug, MIN(t) AS t FROM events WHERE patient_id = ? AND kind = 'med' GROUP BY drug`).all(id) as { drug: string; t: number }[];
    if (allFirst.every((d) => now - d.t > 14 * 1440)) out.push('No medication changes');
    void p;
    return out;
  }

  suggestAction(id: string, risk: Risk, drivers: Driver[], facts: string[]): CarePatientDTO['action'] {
    const p = this.patient(id)!;
    const now = this.clock.now();
    const at = clockIST(now + 2);
    const obj = OBJ[p.pronoun];
    const poss = POSS[p.pronoun];
    if (risk.kind === 'low' && risk.level !== 'Low') {
      const med = drivers.find((d) => d.kind === 'new-medicine');
      if (med) {
        const drug = med.text.split(' ')[0];
        return { label: `Review the new ${drug.toLowerCase()} dose`, button: 'Flag for dose review', done: 'Flagged for dose review tomorrow', effect: 'flag' };
      }
      return { label: 'Suggest a small bedtime snack', button: 'Send snack suggestion', done: `Snack suggestion sent · ${at}`, effect: 'snack' };
    }
    if (risk.kind === 'high' && risk.level !== 'Low') {
      if (drivers.some((d) => d.kind === 'illness')) {
        const call = Math.ceil((now + 20) / 15) * 15;
        return { label: `Call tonight to go over ${poss} sick-day plan`, button: 'Schedule a call', done: `Call scheduled for ${clockIST(call)}`, effect: 'call' };
      }
      if (drivers.some((d) => d.kind === 'dose-missed')) return { label: 'Send a dose reminder', button: 'Send reminder', done: `Reminder sent · ${at}`, effect: 'reminder' };
      return { label: `Check in with ${obj} about tonight's meals`, button: 'Send a check-in', done: `Check-in sent · ${at}`, effect: 'checkin' };
    }
    if (facts.some((f) => f.startsWith('Sensor expires'))) {
      return { label: `Remind ${obj} to change the sensor`, button: 'Send sensor reminder', done: `Sensor reminder sent · ${at}`, effect: 'sensor' };
    }
    return { label: 'No action needed tonight', button: 'Acknowledge', done: 'Acknowledged', effect: 'ack' };
  }

  nightKey(now = this.clock.now()) {
    const d = new Date((istMidnight(now - 12 * 60) + 330) * 60_000);
    return d.toISOString().slice(0, 10);
  }

  careEntry(id: string): CarePatientDTO | null {
    const p = this.patient(id);
    if (!p) return null;
    const rd = this.riskAndDrivers(id);
    const facts = this.facts(id);
    const risk: Risk = rd?.risk ?? { kind: 'stable', level: 'Low', probability: 0, title: 'No forecast yet', short: 'No twin yet', window: 'Connect a CGM and build the twin' };
    const driverTexts = rd?.drivers.map((d) => d.text) ?? [];
    const lines = !rd ? ['No forecast available', ...facts] : risk.kind === 'stable' ? ['Forecast stable and in range', ...facts] : [...driverTexts, ...facts.filter((f) => !f.startsWith('No medication'))];
    const review = this.db.prepare('SELECT status, note FROM reviews WHERE patient_id = ? AND night = ?').get(id, this.nightKey()) as { status: CarePatientDTO['review']; note: string | null } | undefined;
    const action = this.suggestAction(id, risk, rd?.drivers ?? [], facts);
    return {
      patient: patientSummary(p, !!this.twin(id)),
      latest: this.latest(id),
      risk,
      drivers: lines.slice(0, 3),
      topDriver: shortDriver(lines[0] ?? 'No data yet'),
      facts,
      review: review?.status ?? 'new',
      reviewNote: review?.note ?? null,
      action,
      alert: this.currentAlert(id),
    };
  }

  /* ---------------- alerts ---------------- */

  alertDTO(a: AlertRow): AlertDTO {
    const now = this.clock.now();
    const snack = a.snack_event_id ? (this.db.prepare('SELECT t FROM events WHERE id = ?').get(a.snack_event_id) as { t: number } | undefined) : undefined;
    return {
      id: a.id,
      kind: a.kind,
      issuedAt: a.issued_at,
      status: a.status,
      handledAt: a.handled_at,
      windowFrom: a.window_from,
      windowTo: a.window_to,
      lowest: a.lowest,
      lowestAt: a.lowest_at,
      probability: a.probability,
      drivers: json<Driver[]>(a.drivers, []),
      snackAt: snack?.t ?? null,
      canUndo: a.status !== 'snack' || !snack || snack.t > now,
    };
  }

  /** The alert for tonight (issued within the last 12 hours), most recent first. */
  currentAlert(id: string): AlertDTO | null {
    if (!this.canBuild(id)) return null;
    const now = this.clock.now();
    const latest = this.latestReading(id);
    const lowNow = !!latest && now - latest.t <= 10 && latest.mgdl < 70;
    // A forecast alert is current until its window ends; alerts stored without one last the 6-hour horizon.
    const a = this.db
      .prepare(`SELECT * FROM alerts WHERE patient_id = ? AND issued_at > ? AND issued_at <= ?
        AND (kind != 'cgm-low' OR ?)
        AND (kind = 'cgm-low' OR COALESCE(window_to, issued_at + 360) > ?)
        ORDER BY CASE kind WHEN 'cgm-low' THEN 0 ELSE 1 END, issued_at DESC, id DESC LIMIT 1`)
      .get(id, now - 12 * 60, now, lowNow ? 1 : 0, now) as AlertRow | undefined;
    if (!a) return null;
    const dto = this.alertDTO(a);
    return a.kind === 'cgm-low' && latest ? { ...dto, lowest: latest.mgdl, lowestAt: latest.t } : dto;
  }

  /** Creates predicted-low / predicted-high / CGM-low alerts when the twin or the sensor calls for one. */
  evaluateAlerts(id: string): number | null {
    if (!this.canBuild(id)) return null;
    const now = this.clock.now();
    const recent = this.db.prepare(`SELECT kind FROM alerts WHERE patient_id = ? AND issued_at > ?`).all(id, now - 10 * 60) as { kind: string }[];
    const has = (k: string) => recent.some((r) => r.kind === k);
    const last = this.latestReading(id);
    if (last && now - last.t <= 10 && last.mgdl < 70) {
      const recentCgm = this.db.prepare(`SELECT 1 FROM alerts WHERE patient_id = ? AND kind = 'cgm-low' AND issued_at > ?`).get(id, now - 180);
      if (!recentCgm) return this.createAlert(id, { kind: 'cgm-low', issued_at: last.t, lowest: last.mgdl, lowest_at: last.t, probability: 1, drivers: '[]' });
    }
    const rd = this.riskAndDrivers(id);
    if (!rd) return null;
    const { risk, drivers, forecast: fc } = rd;
    if (risk.kind === 'low' && risk.level === 'High' && !has('predicted-low')) {
      return this.createAlert(id, {
        kind: 'predicted-low',
        issued_at: now,
        window_from: fc.riskWindow?.from ?? null,
        window_to: fc.riskWindow?.to ?? fc.lowest.t + 60,
        lowest: fc.lowest.v,
        lowest_at: fc.lowest.t,
        probability: fc.pLow,
        drivers: JSON.stringify(drivers),
      });
    }
    if (risk.kind === 'high' && risk.level === 'High' && !has('predicted-high')) {
      // The alert lasts until the forecast comes back under 180, or to the end of the horizon.
      const back = fc.median.find((p, i) => i > 0 && p.v <= 180 && fc.median[i - 1].v > 180);
      return this.createAlert(id, {
        kind: 'predicted-high',
        issued_at: now,
        window_from: now,
        window_to: back?.t ?? fc.end,
        lowest: fc.highest.v,
        lowest_at: fc.highest.t,
        probability: risk.probability,
        drivers: JSON.stringify(drivers),
      });
    }
    return null;
  }

  private createAlert(id: string, a: Partial<AlertRow> & Pick<AlertRow, 'kind' | 'issued_at' | 'drivers'>): number {
    const r = this.db
      .prepare(
        `INSERT INTO alerts (patient_id, kind, issued_at, status, window_from, window_to, lowest, lowest_at, probability, drivers)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, a.kind, a.issued_at, a.window_from ?? null, a.window_to ?? null, a.lowest ?? null, a.lowest_at ?? null, a.probability ?? null, a.drivers);
    const alertId = Number(r.lastInsertRowid);
    this.bus.publish({ type: 'alert', patientId: id, alertId });
    return alertId;
  }

  /** Plans a 15 g bedtime snack that the (synthetic) patient will eat. */
  planSnack(id: string): number {
    const now = this.clock.now();
    const existing = this.plannedSnack(id);
    if (existing) return existing.id;
    const tw = this.twin(id);
    let bed = istMidnight(now) + (tw?.routine.sleepAt ?? 22 * 60 + 45) - 15;
    if (bed < now + 15) bed = now + 15;
    const eventId = insertEvent(this.db, id, { kind: 'meal', t: bed, carbs: 15, trueCarbs: 15, speed: 1.0, label: 'Bedtime snack (milk or a banana)', source: 'suggested' });
    this.touch(id);
    this.bus.publish({ type: 'events', patientId: id });
    return eventId;
  }

  cancelSnack(id: string, eventId: number | null) {
    const now = this.clock.now();
    if (eventId) this.db.prepare(`DELETE FROM events WHERE id = ? AND patient_id = ? AND t > ?`).run(eventId, id, now);
    this.touch(id);
    this.bus.publish({ type: 'events', patientId: id });
  }

  /* ---------------- dashboard pieces ---------------- */

  twinSummary(id: string): TwinSummaryDTO | null {
    const tw = this.twin(id);
    if (!tw) return null;
    const inferred = this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE patient_id = ? AND source = 'inferred' AND t > ?`).get(id, this.clock.now() - 14 * 1440) as { n: number };
    const mae = tw.calibration.mae;
    return {
      fittedAt: tw.fittedAt,
      days: tw.fit.days,
      rmse: Math.round(tw.fit.rmse * 10) / 10,
      mard: Math.round(tw.fit.mard * 10) / 10,
      trackRecord: { h1: mae[1] ?? 0, h4: mae[7] ?? 0, nights: tw.calibration.nights },
      insights: tw.insights,
      inferredMeals: inferred.n,
    };
  }

  today(id: string): TodayDTO {
    const now = this.clock.now();
    const start = istMidnight(now);
    const rs = this.readings(id, start, now);
    const vit = this.db.prepare('SELECT steps, resting_hr FROM vitals WHERE patient_id = ? AND day = ?').get(id, start) as { steps: number; resting_hr: number } | undefined;
    const hr7 = this.db.prepare('SELECT AVG(resting_hr) AS hr FROM vitals WHERE patient_id = ? AND day > ?').get(id, start - 7 * 1440) as { hr: number | null };
    const sleep = this.db
      .prepare(`SELECT duration FROM events WHERE patient_id = ? AND kind = 'sleep' AND hidden = 0 AND t + duration <= ? ORDER BY t DESC LIMIT 1`)
      .get(id, now) as { duration: number } | undefined;
    // Steps accrue through the day: walk steps so far plus a share of the daily baseline.
    const walks = this.db.prepare(`SELECT COALESCE(SUM(steps), 0) AS s FROM events WHERE patient_id = ? AND kind = 'walk' AND t >= ? AND t <= ?`).get(id, start, now) as { s: number };
    const sources = this.sourceFlags(id);
    return {
      inRangePct: sources.cgm && rs.length ? Math.round((100 * rs.filter((r) => r.mgdl >= 70 && r.mgdl <= 180).length) / rs.length) : null,
      steps: sources.watch && vit ? Math.max(walks.s, Math.round(((vit.steps - walks.s) * Math.max(0, now - start - 360)) / (16 * 60)) + walks.s) : null,
      sleepMinutes: sources.watch && sleep ? sleep.duration : null,
      restingHr: sources.watch && hr7.hr ? Math.round(hr7.hr) : null,
    };
  }

  sourceFlags(id: string): Record<string, boolean> {
    const rows = this.db.prepare('SELECT source, connected FROM sources WHERE patient_id = ?').all(id) as { source: string; connected: number }[];
    const out: Record<string, boolean> = { cgm: false, watch: false, abha: false, meals: false, bp: false };
    for (const r of rows) out[r.source] = !!r.connected;
    return out;
  }

  outlook(id: string): OutlookDTO {
    return this.memo(this.key(id, 'outlook'), () => {
      const labs = this.db
        .prepare(`SELECT date, value FROM records WHERE patient_id = ? AND kind = 'lab' AND name = 'HbA1c' COLLATE NOCASE AND value IS NOT NULL ORDER BY date`)
        .all(id) as { date: string; value: number }[];
      const now = this.clock.now();
      const g = gmiFromReadings(this.readings(id, now - 14 * 1440, now), now);
      const tw = this.twin(id);
      const projection = tw ? { keep: round1(projectGmi(tw.params, tw.routine, 'keep')), stop: round1(projectGmi(tw.params, tw.routine, 'stop')) } : null;
      return { labs: labs.slice(-3), estimate: g ? round1(g.value) : null, projection, target: 7.0 };
    });
  }

  timeline(id: string): TimelineItem[] {
    const now = this.clock.now();
    const start = istMidnight(now);
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE patient_id = ? AND hidden = 0 AND t >= ? AND t <= ? AND kind != 'sleep' ORDER BY t DESC`)
      .all(id, start, now) as EventRow[];
    const items: TimelineItem[] = rows.map((r) => describeEvent(r));
    const tw = this.twin(id);
    if (tw && tw.fittedAt >= start - 6 * 60 && tw.fittedAt <= now) {
      items.push({ id: 0, t: tw.fittedAt, kind: 'meal', title: 'Twin re-fitted overnight', note: `Parameters updated from the last ${tw.fit.days} days of data`, source: 'twin', inferred: false });
    }
    return items.sort((a, b) => b.t - a.t);
  }

  /* ---------------- what-if ---------------- */

  whatIf(id: string, req: WhatIfRequest): WhatIfDTO | null {
    const tw = this.twin(id);
    if (!tw) return null;
    const result = simulateEvening(tw.params, tw.logSd, tw.routine, req);
    const usual = this.memo(this.key(id, 'usual'), () =>
      simulateEvening(tw.params, tw.logSd, tw.routine, { meal: { carbs: 75, speed: 1.35 }, portion: 1, walk: 0, sleep: 7, med: 'taken' }),
    );
    return {
      result,
      usual,
      usualLabel: `${cap(POSS[this.patient(id)?.pronoun ?? 'they'])} usual: rice plate, no walk`,
      verdict: verdict(result),
      deltaPeak: Math.round(result.peak) - Math.round(usual.peak),
    };
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function mealName(e: TwinEvent) {
  if (e.kind !== 'meal') return '';
  const l = (e.label ?? '').toLowerCase();
  if (e.source === 'suggested') return 'Bedtime snack';
  const slot = mealSlot(minuteOfDayIST(e.t));
  if (/tea|coffee/.test(l)) return 'Tea';
  if (/sweet/.test(l)) return 'Sweets';
  return slot ? slot[0].toUpperCase() + slot.slice(1) : 'Meal';
}

function shortDriver(text: string) {
  return text
    .replace(/^Dinner was about (\d+) g lighter in carbs than \w+ usual$/, 'Light dinner')
    .replace(/^A (\d+)-minute walk straight after dinner$/, '$1-min walk after dinner')
    .replace(/ logged at \d\d:\d\d$/, '')
    .replace(/ — from .*$/, '');
}

function describeEvent(r: EventRow): TimelineItem {
  const base = { id: r.id, t: r.t, kind: r.kind, source: r.source, inferred: r.source === 'inferred' };
  const via: Record<string, string> = { photo: 'Meal photo', voice: 'Voice note', device: 'Smartwatch', logged: 'Logged in app', suggested: 'Suggested by the twin', inferred: 'Detected by the twin from CGM' };
  switch (r.kind) {
    case 'meal':
      return {
        ...base,
        title:
          r.source === 'inferred'
            ? 'Possible unlogged meal'
            : r.source === 'suggested'
              ? (r.label ?? 'Planned snack')
              : (r.label ?? '').toLowerCase().startsWith(mealName(rowToEvent(r)).toLowerCase())
                ? (r.label ?? 'Meal')
                : `${mealName(rowToEvent(r))} · ${r.label ?? 'Meal'}`,
        note: `${r.note ?? via[r.source ?? 'logged'] ?? 'Logged'} · ≈ ${Math.round(r.carbs ?? 0)} g carbs${r.source === 'inferred' ? ' — confirm or delete' : ''}`,
      };
    case 'walk':
      return { ...base, title: `Walk · ${r.duration} min${r.steps ? `, ${r.steps.toLocaleString('en-IN')} steps` : ''}`, note: via[r.source ?? 'device'] ?? 'Smartwatch' };
    case 'med':
      return { ...base, title: `${DRUG[r.drug ?? ''] ?? r.drug} ${r.dose} mg taken`, note: via[r.source ?? 'logged'] ?? 'Logged in app' };
    case 'illness':
      return { ...base, title: r.label ?? 'Feeling unwell', note: 'Logged in app' };
    default:
      return { ...base, title: 'Sleep', note: formatDuration(r.duration ?? 0) };
  }
}
