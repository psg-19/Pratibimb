/**
 * What-if on the twin: tonight's dinner played forward with the patient's fitted physiology.
 * Reports the post-dinner peak, time above 180, the difference from the usual dinner, and —
 * because a lighter dinner and a long walk can cause a low hours later — the overnight low.
 */
import { buildInputs, fillMeals, simulate, steadyState, setPoint, type PhysioParams } from '../physio/model';
import { rng } from '../rng';
import { FIT_KEYS, type FitKey } from './fit';
import type { LearnedRoutine } from './routine';
import { eveningEvents, SCENARIO_DAY, type EveningPlan } from './scenario';

export interface WhatIfMeal {
  carbs: number;
  speed: number;
}

export interface WhatIfInput {
  meal: WhatIfMeal;
  portion: number;
  walk: number;
  sleep: number;
  med: 'taken' | 'missed';
}

export interface WhatIfResult {
  /** Glucose per minute, 0–180 after dinner (median). */
  pts: number[];
  /** 10th / 90th percentile every 6 minutes. */
  band: { t: number; lo: number; hi: number }[];
  peak: number;
  peakT: number;
  aboveMin: number;
  /** Lowest median glucose from dinner to 07:00. */
  overnightLow: number;
  overnightLowAt: number;
  /** Chance of < 70 for ≥ 15 min overnight. */
  pLowOvernight: number;
}

const SENSOR_LAG = 8;

export function simulateEvening(
  params: PhysioParams,
  logSd: Partial<Record<FitKey, number>>,
  routine: LearnedRoutine,
  input: WhatIfInput,
  opts: { members?: number; seed?: number } = {},
): WhatIfResult {
  const plan: EveningPlan = {
    carbs: input.meal.carbs * input.portion,
    speed: input.meal.speed,
    walk: input.walk,
    sleep: input.sleep,
    eveningDose: input.med === 'taken',
  };
  // Simulate the evening after a day of burn-in, on an IST-aligned reference day.
  const dayStart = SCENARIO_DAY;
  const { events, dinner } = eveningEvents(routine, plan, dayStart);
  const prev = eveningEvents(routine, { ...plan, carbs: routine.meals.find((m) => m.slot === 'dinner')?.carbs ?? 80, walk: 0, eveningDose: true, sleep: 7 }, dayStart - 1440).events;
  const t0 = dayStart - 1440;
  const len = dinner + 660 - t0;
  const inp = buildInputs([...prev.filter((e) => e.t < dayStart), ...events], t0, len);
  const members = opts.members ?? 40;
  const r = rng(opts.seed ?? 42);
  const traces: Float64Array[] = [];
  for (let m = 0; m < members; m++) {
    const p = { ...params };
    if (m > 0) {
      for (const k of FIT_KEYS) {
        const sd = Math.hypot(1.5 * (logSd[k] ?? 0), k === 'SI' ? 0.12 : k === 'carbGain' ? 0.08 : 0);
        if (sd > 0) p[k] = params[k] * Math.exp(sd * r.normal());
      }
    }
    fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
    const sim = simulate(p, inp, steadyState(p, setPoint(p, inp, 0)));
    const out = new Float64Array(len);
    let gi = sim.G[0];
    for (let i = 0; i < len; i++) {
      gi += (sim.G[i] - gi) / SENSOR_LAG;
      out[i] = gi;
    }
    traces.push(out);
  }
  const off = dinner - t0;
  const median = (i: number) => {
    const col = traces.map((tr) => tr[i]).sort((a, b) => a - b);
    return col[Math.floor(col.length / 2)];
  };
  const pts: number[] = [];
  for (let t = 0; t <= 180; t++) pts.push(median(off + t));
  const band = [];
  for (let t = 0; t <= 180; t += 6) {
    const col = traces.map((tr) => tr[off + t]).sort((a, b) => a - b);
    band.push({ t, lo: col[Math.floor(0.1 * (col.length - 1))], hi: col[Math.ceil(0.9 * (col.length - 1))] });
  }
  let peak = -Infinity;
  let peakT = 0;
  let aboveMin = 0;
  pts.forEach((v, t) => {
    if (v > peak) {
      peak = v;
      peakT = t;
    }
    if (v > 180) aboveMin++;
  });
  let low = Infinity;
  let lowAt = 0;
  for (let t = 180; t < 660; t += 5) {
    const v = median(off + t);
    if (v < low) {
      low = v;
      lowAt = t;
    }
  }
  let lows = 0;
  for (const tr of traces) {
    let run = 0;
    for (let t = 60; t < 660; t++) {
      run = tr[off + t] < 70 ? run + 1 : 0;
      if (run >= 15) {
        lows++;
        break;
      }
    }
  }
  return { pts, band, peak, peakT, aboveMin, overnightLow: low, overnightLowAt: lowAt, pLowOvernight: lows / members };
}

export type Verdict = 'in-range' | 'brief' | 'long';
export function verdict(r: Pick<WhatIfResult, 'peak' | 'aboveMin'>): Verdict {
  if (Math.round(r.peak) <= 180) return 'in-range';
  return r.aboveMin <= 30 ? 'brief' : 'long';
}
