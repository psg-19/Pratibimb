/**
 * Unannounced-meal detection. Patients don't log every meal; an unexplained rise in CGM
 * would otherwise be blamed on the wrong physiology. We look for rises the twin cannot
 * explain with the logged events, estimate the carbohydrate that best explains each one
 * (linear least squares on the twin's response to a reference meal), and return them as
 * "inferred" meals the patient can confirm or delete.
 */
import type { MealEvent, TwinEvent } from '../physio/events';
import { buildInputs, fillMeals, simulate, steadyState, type PhysioParams } from '../physio/model';
import type { Observation } from './fit';

const SENSOR_LAG = 8;
const REF_CARBS = 10;
const REF_SPEED = 1.25;
const WINDOW = 180;

function sensorSide(G: Float64Array) {
  const out = new Float64Array(G.length);
  let gi = G[0];
  for (let i = 0; i < G.length; i++) {
    gi += (G[i] - gi) / SENSOR_LAG;
    out[i] = gi;
  }
  return out;
}

/** Sensor-side glucose response (mg/dL above baseline) to a 10 g reference meal. */
function unitResponse(p: PhysioParams): Float64Array {
  const len = WINDOW + 60;
  const t0 = 0;
  const base = buildInputs([], t0, len);
  const withMeal = buildInputs([{ kind: 'meal', t: 30, carbs: REF_CARBS, speed: REF_SPEED }], t0, len);
  for (const inp of [base, withMeal]) {
    inp.dawn.fill(0);
    fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  }
  const s0 = steadyState(p);
  const a = sensorSide(simulate(p, base, s0).G);
  const b = sensorSide(simulate(p, withMeal, s0).G);
  const out = new Float64Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) out[i] = b[30 + i] - a[30 + i];
  return out;
}

export interface DetectOptions {
  from: number;
  to: number;
  /** Minimum unexplained rise over 45 minutes, mg/dL. */
  minRise?: number;
}

export function detectUnloggedMeals(
  p: PhysioParams,
  events: readonly TwinEvent[],
  readings: readonly Observation[],
  opts: DetectOptions,
): MealEvent[] {
  const { from, to } = opts;
  const minRise = opts.minRise ?? 22;
  const inp = buildInputs(events, from, to - from);
  fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  const rs = readings.filter((r) => r.t >= from && r.t < to);
  if (rs.length < 48) return [];
  const trace = sensorSide(simulate(p, inp, { G: rs[0].mgdl, X: 0, I: p.Ib, A: 0, B: 0 }).G);

  // Residual on a regular 5-minute grid (NaN where readings are missing).
  const n = Math.floor((to - from) / 5);
  const obs = new Float64Array(n).fill(NaN);
  for (const r of rs) {
    const k = Math.floor((r.t - from) / 5);
    if (k >= 0 && k < n) obs[k] = r.mgdl;
  }
  const res = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) if (!Number.isNaN(obs[k])) res[k] = obs[k] - trace[k * 5];

  const unit = unitResponse(p);
  const loggedMeals = events.filter((e) => e.kind === 'meal').map((e) => e.t);
  const found: MealEvent[] = [];
  const near = (t: number, ts: number[], before: number, after: number) => ts.some((m) => t - m < before && m - t < after);

  for (let k = 12; k < n - 12; k++) {
    const a = res[k];
    const b = res[k + 9];
    const oa = obs[k];
    const ob = obs[k + 9];
    if ([a, b, oa, ob].some(Number.isNaN)) continue;
    if (b - a < minRise || ob - oa < minRise * 0.8) continue;
    const onset = from + k * 5 - 10;
    if (near(onset, loggedMeals, 90, 30) || near(onset, found.map((f) => f.t), 150, 150)) continue;

    // Least-squares carbs for a meal at `onset` against the residual.
    let num = 0;
    let den = 0;
    for (let j = 0; j < WINDOW; j += 5) {
      const kk = Math.floor((onset - from + j) / 5);
      if (kk < 0 || kk >= n || Number.isNaN(res[kk])) continue;
      const u = unit[j];
      num += (res[kk] - a) * u;
      den += u * u;
    }
    if (den <= 0) continue;
    const carbs = Math.round(Math.min(100, Math.max(0, (REF_CARBS * num) / den)) / 5) * 5;
    if (carbs < 10) continue;
    found.push({ kind: 'meal', t: onset, carbs, speed: REF_SPEED, label: 'Possible unlogged meal', source: 'inferred' });
    // Remove its explained part so the same rise is not counted twice.
    for (let j = 0; j < WINDOW; j += 5) {
      const kk = Math.floor((onset - from + j) / 5);
      if (kk >= 0 && kk < n && !Number.isNaN(res[kk])) res[kk] -= (carbs / REF_CARBS) * unit[j];
    }
  }
  return found;
}
