/**
 * Self-calibration from the twin's own track record. After each fit the twin replays its
 * last N evenings: it forecasts from the same clock time using only the state it could have
 * known then (logged events), compares with what the CGM then showed, and learns its mean
 * error and spread by lead time. Forecasts are shifted by that bias and widened by that
 * spread, so the stated chance of a low reflects how well this twin has actually done.
 */
import type { TwinEvent } from '../physio/events';
import { buildInputs, fillMeals, simulate, type PhysioParams } from '../physio/model';
import type { Observation } from './fit';
import { estimateState } from './forecast';

export const CAL_STEP = 30;
const SENSOR_LAG = 8;

export interface Calibration {
  /** Mean (observed − forecast) per 30-minute lead bucket, mg/dL (shrunk toward 0). */
  bias: number[];
  /** Residual SD per lead bucket, mg/dL. */
  sd: number[];
  /** Mean absolute error per bucket — reported, not used in the forecast. */
  mae: number[];
  nights: number;
  horizon: number;
}

export function deterministicTrace(p: PhysioParams, events: readonly TwinEvent[], readings: readonly Observation[], start: number, horizon: number) {
  const state = estimateState(p, events, readings, start);
  const inp = buildInputs(events, start, horizon);
  fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  const sim = simulate(p, inp, state);
  const last = readings.filter((r) => r.t <= start).at(-1);
  let gi = last ? last.mgdl : state.G;
  const out = new Float64Array(horizon);
  for (let i = 0; i < horizon; i++) {
    gi += (sim.G[i] - gi) / SENSOR_LAG;
    out[i] = gi;
  }
  return out;
}

export function calibrate(
  p: PhysioParams,
  events: readonly TwinEvent[],
  readings: readonly Observation[],
  now: number,
  opts: { nights?: number; horizon?: number } = {},
): Calibration {
  const nights = opts.nights ?? 10;
  const horizon = opts.horizon ?? 720;
  const buckets = Math.ceil(horizon / CAL_STEP);
  const sum = new Float64Array(buckets);
  const sq = new Float64Array(buckets);
  const abs = new Float64Array(buckets);
  const cnt = new Float64Array(buckets);
  const byT = new Map(readings.map((r) => [r.t, r.mgdl]));
  // Readings come every 5 minutes, but not on the minutes a back-test lands on when the twin is
  // fitted at, say, 03:03 or built at any minute: take the reading within 2 minutes of each lead time.
  const near = (t: number) => {
    for (const d of [0, -1, 1, -2, 2]) {
      const v = byT.get(t + d);
      if (v != null) return v;
    }
    return undefined;
  };
  let used = 0;
  for (let d = 1; d <= nights; d++) {
    const start = now - d * 1440;
    const known = readings.filter((r) => r.t <= start);
    if (known.length < 288 || start - known[known.length - 1].t > 30) continue;
    // Events up to the forecast end: overnight the twin is judged on physiology, not on guessing meals.
    const ev = events.filter((e) => e.t <= start + horizon);
    const tr = deterministicTrace(p, ev, known, start, horizon);
    for (let i = 5; i < horizon; i += 5) {
      const obs = near(start + i);
      if (obs == null) continue;
      const e = obs - tr[i];
      const b = Math.floor(i / CAL_STEP);
      sum[b] += e;
      sq[b] += e * e;
      abs[b] += Math.abs(e);
      cnt[b]++;
    }
    used++;
  }
  const bias: number[] = [];
  const sd: number[] = [];
  const mae: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const n = cnt[b];
    const mean = n ? sum[b] / n : 0;
    // Shrink toward zero when the evidence is thin (n counts 5-minute samples across nights).
    const nightsEq = n / (CAL_STEP / 5);
    bias.push(Math.round(10 * mean * (nightsEq / (nightsEq + 3))) / 10);
    sd.push(Math.round(10 * (n > 1 ? Math.sqrt(Math.max(0, sq[b] / n - mean * mean)) : 10)) / 10);
    mae.push(Math.round(10 * (n ? abs[b] / n : 0)) / 10);
  }
  return { bias, sd, mae, nights: used, horizon };
}

/** Interpolated value of a per-bucket series at a lead time in minutes. */
export function atLead(series: readonly number[], lead: number): number {
  if (series.length === 0) return 0;
  const x = lead / CAL_STEP - 0.5;
  if (x <= 0) return series[0] * Math.min(1, lead / CAL_STEP);
  const i = Math.floor(x);
  if (i >= series.length - 1) return series[series.length - 1];
  const f = x - i;
  return series[i] * (1 - f) + series[i + 1] * f;
}
