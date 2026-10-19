/**
 * Probabilistic forecast. The twin estimates the hidden state now (insulin action, gut
 * contents, walk load) by replaying the last 36 hours while nudging glucose toward the CGM,
 * then plays an ensemble of plausible versions of the patient forward: parameters drawn from
 * the fit's posterior and small physiological noise. The ensemble gives the median, the
 * uncertainty band, the chance of a low or a high, and the window when a low is likeliest.
 */
import type { TwinEvent } from '../physio/events';
import { buildInputs, fillMeals, simulate, type PhysioParams, type PhysioState } from '../physio/model';
import { rng } from '../rng';
import { atLead, type Calibration } from './calibrate';
import { FIT_KEYS, type FitKey, type Observation } from './fit';
import { expectedEvents, type LearnedRoutine } from './routine';

export const LOW = 70;
export const HIGH = 180;
export const VERY_HIGH = 250;
const SENSOR_LAG = 8;
const STATE_WINDOW = 36 * 60;

export interface Point {
  t: number;
  v: number;
}
export interface BandPoint {
  t: number;
  lo: number;
  hi: number;
}

export interface ForecastRequest {
  params: PhysioParams;
  logSd: Partial<Record<FitKey, number>>;
  /** Everything the twin knows: logged and inferred past events plus confirmed plans. */
  events: readonly TwinEvent[];
  readings: readonly Observation[];
  now: number;
  horizon: number;
  routine?: LearnedRoutine;
  members?: number;
  seed?: number;
  /** Uncertainty inflation for model misspecification. */
  inflate?: number;
  /** The twin's learned forecast error by lead time (from its own back-tests). */
  calibration?: Calibration;
}

export interface Forecast {
  now: number;
  end: number;
  /** Latest CGM reading the forecast starts from. */
  start: Observation | null;
  median: Point[];
  band: BandPoint[];
  /** Share of ensemble members below 70 at each 5-minute step. */
  pLowAt: number[];
  /** Chance of a low (< 70 for ≥ 15 min) within the horizon. */
  pLow: number;
  /** Chance of > 250 for ≥ 60 min. */
  pVeryHigh: number;
  /** Chance of > 180 for ≥ 4 hours. */
  pHigh: number;
  riskWindow: { from: number; to: number } | null;
  lowest: Point;
  highest: Point;
  inRangePct: number;
  /** Routine events the twin assumed (e.g. tomorrow's usual breakfast). */
  expected: TwinEvent[];
  state: PhysioState;
}

/** Plasma-side estimate of glucose from lagged CGM: obs + lag × slope. */
function lagCompensated(readings: readonly Observation[], from: number, len: number) {
  const at = new Float64Array(len).fill(NaN);
  for (let k = 0; k < readings.length; k++) {
    const r = readings[k];
    const i = r.t - from;
    if (i < 0 || i >= len) continue;
    const prev = readings[k - 1];
    const slope = prev && r.t - prev.t <= 15 ? (r.mgdl - prev.mgdl) / (r.t - prev.t) : 0;
    at[i] = r.mgdl + SENSOR_LAG * slope;
  }
  return at;
}

/** Estimates the twin's hidden state at `now` from recent CGM and events. */
export function estimateState(p: PhysioParams, events: readonly TwinEvent[], readings: readonly Observation[], now: number): PhysioState {
  const recent = readings.filter((r) => r.t > now - STATE_WINDOW && r.t <= now);
  const from = recent.length ? recent[0].t : now - STATE_WINDOW;
  const len = Math.max(1, now - from);
  const inp = buildInputs(events, from, len);
  fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  const g0 = recent.length ? recent[0].mgdl : p.Gb;
  const sim = simulate(p, inp, { G: g0, X: 0, I: p.Ib, A: 0, B: 0 }, { nudge: { at: lagCompensated(recent, from, len), gain: 0.35 } });
  return sim.final;
}

/**
 * Day-to-day variability the fit cannot know in advance (log-SD per parameter, or mg/dL for
 * Gb): people are not the same every night even with identical inputs.
 */
const DAY_TO_DAY: Partial<Record<FitKey, number>> = { SI: 0.15, carbGain: 0.1, walkLate: 0.25, metEffect: 0.15 };
const SETPOINT_SD = 6;

function perturb(p: PhysioParams, logSd: Partial<Record<FitKey, number>>, inflate: number, r: ReturnType<typeof rng>): PhysioParams {
  const q = { ...p };
  for (const k of FIT_KEYS) {
    const sd = Math.hypot((logSd[k] ?? 0) * inflate, DAY_TO_DAY[k] ?? 0);
    if (sd > 0) q[k] = p[k] * Math.exp(sd * r.normal());
  }
  q.Gb = q.Gb + SETPOINT_SD * r.normal();
  return q;
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Runs the ensemble and returns minute-resolution sensor-side trajectories. */
export function ensemble(req: ForecastRequest, extraEvents: readonly TwinEvent[] = []) {
  const { params, now, horizon } = req;
  const members = req.members ?? 60;
  const inflate = req.inflate ?? 2;
  const r = rng(req.seed ?? now);
  const expected = req.routine ? expectedEvents(req.routine, req.events, now, now + horizon) : [];
  const events = [...req.events, ...expected, ...extraEvents];
  const state = estimateState(params, req.events, req.readings, now);
  const last = req.readings.filter((x) => x.t <= now).at(-1) ?? null;
  const inp = buildInputs(events, now, horizon);
  const traces: Float64Array[] = [];
  const cal = req.calibration;
  for (let m = 0; m < members; m++) {
    const p = m === 0 ? params : perturb(params, req.logSd, inflate, r);
    fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
    const noise = rng((req.seed ?? now) + 7919 * (m + 1));
    // Member 0 is the deterministic twin; the rest add a little physiological noise.
    const sim = simulate(p, inp, { ...state }, m === 0 ? {} : { processNoise: () => 0.25 * noise.normal() });
    const out = new Float64Array(horizon);
    let gi = last ? last.mgdl : state.G;
    // Learned error: shift by the twin's bias at each lead time and, per member, by a
    // residual drawn from its empirical spread (a level that persists through the night).
    const z = m === 0 ? 0 : 0.8 * r.normal();
    for (let i = 0; i < horizon; i++) {
      gi += (sim.G[i] - gi) / SENSOR_LAG;
      out[i] = cal ? gi + atLead(cal.bias, i) + z * atLead(cal.sd, i) : gi;
    }
    traces.push(out);
  }
  return { traces, expected, state, start: last };
}

function runLength(trace: Float64Array, test: (v: number) => boolean, minLen: number) {
  let run = 0;
  for (let i = 0; i < trace.length; i++) {
    run = test(trace[i]) ? run + 1 : 0;
    if (run >= minLen) return true;
  }
  return false;
}

export function forecast(req: ForecastRequest, extraEvents: readonly TwinEvent[] = []): Forecast {
  const { now, horizon } = req;
  const { traces, expected, state, start } = ensemble(req, extraEvents);
  const n = traces.length;
  const median: Point[] = [];
  const band: BandPoint[] = [];
  const pLowAt: number[] = [];
  for (let i = 0; i < horizon; i += 5) {
    const col = traces.map((tr) => tr[i]).sort((a, b) => a - b);
    median.push({ t: now + i, v: quantile(col, 0.5) });
    if (i % 10 === 0) band.push({ t: now + i, lo: quantile(col, 0.1), hi: quantile(col, 0.9) });
    pLowAt.push(col.filter((v) => v < LOW).length / n);
  }
  const lastCol = traces.map((tr) => tr[horizon - 1]).sort((a, b) => a - b);
  median.push({ t: now + horizon, v: quantile(lastCol, 0.5) });
  band.push({ t: now + horizon, lo: quantile(lastCol, 0.1), hi: quantile(lastCol, 0.9) });

  const pLow = traces.filter((tr) => runLength(tr, (v) => v < LOW, 15)).length / n;
  const pVeryHigh = traces.filter((tr) => runLength(tr, (v) => v > VERY_HIGH, 60)).length / n;
  const pHigh = traces.filter((tr) => runLength(tr, (v) => v > HIGH, 240)).length / n;

  // Risk window: the contiguous stretch around the peak chance of a low where it stays at or
  // above 40 % (or within 15 points of the peak when the peak itself is lower).
  let riskWindow: Forecast['riskWindow'] = null;
  const peak = Math.max(...pLowAt);
  if (peak >= 0.2) {
    const k = pLowAt.indexOf(peak);
    const cut = Math.min(0.4, peak - 0.15);
    let a = k;
    let b = k;
    while (a > 0 && pLowAt[a - 1] >= cut) a--;
    while (b < pLowAt.length - 1 && pLowAt[b + 1] >= cut) b++;
    riskWindow = { from: now + a * 5, to: now + b * 5 };
  }
  const body = median.slice(1);
  const lowest = body.reduce((m, p) => (p.v < m.v ? p : m), body[0]);
  const highest = body.reduce((m, p) => (p.v > m.v ? p : m), body[0]);
  const inRangePct = Math.round((100 * body.filter((p) => p.v >= LOW && p.v <= HIGH).length) / Math.max(1, body.length));
  return { now, end: now + horizon, start, median, band, pLowAt, pLow, pVeryHigh, pHigh, riskWindow, lowest, highest, inRangePct, expected, state };
}
