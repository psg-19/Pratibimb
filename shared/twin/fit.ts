/**
 * Fits a patient's personal physiology to their own CGM history and logged events.
 *
 * Maximum a-posteriori estimate: squared CGM residuals (after a sensor-lag filter) plus a
 * log-normal prior around population values, minimised with Nelder–Mead in log space.
 * A diagonal Laplace approximation gives per-parameter uncertainty for the forecast ensemble.
 */
import type { TwinEvent } from '../physio/events';
import { buildInputs, fillMeals, POPULATION, setPoint, simulate, type Inputs, type PhysioParams } from '../physio/model';

export const FIT_KEYS = ['Gb', 'SI', 'carbGain', 'tmax', 'slowFrac', 'walkAcute', 'walkLate', 'metEffect', 'sleepSens', 'dawn'] as const;
export type FitKey = (typeof FIT_KEYS)[number];

/** Prior SD in log space (how far a person may plausibly differ from the population). */
const PRIOR_SD: Record<FitKey, number> = {
  Gb: 0.12,
  SI: 0.5,
  carbGain: 0.3,
  tmax: 0.3,
  slowFrac: 0.4,
  walkAcute: 0.6,
  walkLate: 0.7,
  metEffect: 0.5,
  sleepSens: 0.8,
  dawn: 0.4,
};

const BOUNDS: Record<FitKey, [number, number]> = {
  Gb: [80, 220],
  SI: [5e-5, 2e-3],
  carbGain: [1.5, 9],
  tmax: [25, 120],
  slowFrac: [0.05, 0.6],
  walkAcute: [0.05, 2],
  walkLate: [0.02, 3],
  metEffect: [2, 70],
  sleepSens: [0.005, 0.3],
  dawn: [0, 50],
};

export interface Observation {
  t: number;
  mgdl: number;
}

export interface FitResult {
  params: PhysioParams;
  /** Posterior SD of log(param) for each fitted key. */
  logSd: Record<FitKey, number>;
  /** Root-mean-square error of the fitted model against CGM, mg/dL. */
  rmse: number;
  /** Mean absolute relative difference, %. */
  mard: number;
  n: number;
  evals: number;
  from: number;
  to: number;
}

const SENSOR_LAG = 8;

class Objective {
  readonly inp: Inputs;
  readonly idx: Int32Array;
  readonly obs: Float64Array;
  evals = 0;

  constructor(
    events: readonly TwinEvent[],
    readings: readonly Observation[],
    readonly from: number,
    readonly to: number,
    readonly base: PhysioParams,
    readonly prior: PhysioParams,
  ) {
    this.inp = buildInputs(events, from, to - from);
    const rs = readings.filter((r) => r.t >= from + 60 && r.t < to);
    this.idx = Int32Array.from(rs.map((r) => r.t - from));
    this.obs = Float64Array.from(rs.map((r) => r.mgdl));
  }

  toParams(u: readonly number[]): PhysioParams {
    const p = { ...this.base };
    FIT_KEYS.forEach((k, i) => {
      const [lo, hi] = BOUNDS[k];
      p[k] = Math.min(hi, Math.max(lo, Math.exp(u[i])));
    });
    return p;
  }

  /** Sensor-side trace for the given parameters. */
  trace(p: PhysioParams) {
    fillMeals(this.inp, p.tmax, p.tmaxSlow, p.slowFrac);
    const g0 = this.obs.length ? this.obs[0] : setPoint(p, this.inp, 0);
    const sim = simulate(p, this.inp, { G: g0, X: 0, I: p.Ib, A: 0, B: 0 });
    const G = sim.G;
    let gi = G[0];
    const out = new Float64Array(G.length);
    for (let i = 0; i < G.length; i++) {
      gi += (G[i] - gi) / SENSOR_LAG;
      out[i] = gi;
    }
    return out;
  }

  /**
   * Negative log posterior. CGM residuals are strongly autocorrelated (≈ 30 min), so each
   * 5-minute reading counts as 1/6 of an independent observation.
   */
  value(u: readonly number[], sigma = 10, weight = 1 / 6): number {
    this.evals++;
    const p = this.toParams(u);
    const tr = this.trace(p);
    let sse = 0;
    for (let j = 0; j < this.idx.length; j++) {
      const r = this.obs[j] - tr[this.idx[j]];
      sse += r * r;
    }
    let pen = 0;
    FIT_KEYS.forEach((k, i) => {
      const z = (u[i] - Math.log(this.prior[k])) / PRIOR_SD[k];
      pen += z * z;
    });
    return 0.5 * weight * (sse / (sigma * sigma)) + 0.5 * pen;
  }

  stats(p: PhysioParams) {
    const tr = this.trace(p);
    let sse = 0;
    let ard = 0;
    for (let j = 0; j < this.idx.length; j++) {
      const r = this.obs[j] - tr[this.idx[j]];
      sse += r * r;
      ard += Math.abs(r) / this.obs[j];
    }
    const n = this.idx.length;
    return { rmse: Math.sqrt(sse / Math.max(1, n)), mard: (100 * ard) / Math.max(1, n), n };
  }
}

/** Nelder–Mead simplex minimisation with dimension-adaptive coefficients (Gao & Han 2012). */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], maxEvals: number, tol = 1e-8) {
  const n = x0.length;
  const EXP = 1 + 2 / n;
  const CON = 0.75 - 1 / (2 * n);
  const SHR = 1 - 1 / n;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))];
  let values = simplex.map(f);
  let evals = simplex.length;
  while (evals < maxEvals) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    simplex = order.map(([, i]) => simplex[i]);
    values = order.map(([v]) => v);
    if (Math.abs(values[n] - values[0]) <= tol * (Math.abs(values[0]) + 1e-9)) break;
    const spread = Math.max(...simplex[n].map((v, j) => Math.abs(v - simplex[0][j])));
    if (spread < 1e-5) break;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((a, x) => a + x[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = along(-1);
    const fr = f(xr);
    evals++;
    if (fr < values[0]) {
      const xe = along(-EXP);
      const fe = f(xe);
      evals++;
      if (fe < fr) [simplex[n], values[n]] = [xe, fe];
      else [simplex[n], values[n]] = [xr, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [xr, fr];
    } else {
      const outside = fr < values[n];
      const xc = along(outside ? -CON : CON);
      const fc = f(xc);
      evals++;
      if (fc < (outside ? fr : values[n])) {
        [simplex[n], values[n]] = [xc, fc];
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + SHR * (v - simplex[0][j]));
          values[i] = f(simplex[i]);
          evals++;
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values));
  return { x: simplex[best], value: values[best], evals };
}

export interface FitOptions {
  /** Window to fit; defaults to the last 14 days of readings. */
  from?: number;
  to?: number;
  prior?: PhysioParams;
  /** Fixed (non-fitted) parameters; defaults to the prior. */
  base?: PhysioParams;
  maxEvals?: number;
  restarts?: number;
  /** Warm start (e.g. last night's fit). */
  init?: PhysioParams;
  /** Initial simplex step as a fraction of each prior SD. */
  stepScale?: number;
}

export function fitTwin(events: readonly TwinEvent[], readings: readonly Observation[], opts: FitOptions = {}): FitResult {
  if (readings.length < 288) throw new Error('Need at least a day of CGM readings to fit the twin.');
  const prior = opts.prior ?? POPULATION;
  const base = opts.base ?? prior;
  const to = opts.to ?? readings[readings.length - 1].t + 1;
  const from = opts.from ?? Math.max(readings[0].t, to - 14 * 1440);
  const obj = new Objective(events, readings, from, to, base, prior);
  const f = (u: number[]) => obj.value(u);

  let x = FIT_KEYS.map((k) => Math.log((opts.init ?? prior)[k]));
  let value = Infinity;
  const restarts = opts.restarts ?? 3;
  const budget = opts.maxEvals ?? 3600;
  for (let r = 0; r < restarts; r++) {
    const res = nelderMead(f, x, FIT_KEYS.map((k) => (opts.stepScale ?? 0.6) * PRIOR_SD[k]), Math.round(budget / restarts));
    if (res.value < value) {
      value = res.value;
      x = res.x;
    }
  }

  // Diagonal Laplace approximation of the posterior in log space.
  const h = 0.05;
  const logSd = {} as Record<FitKey, number>;
  FIT_KEYS.forEach((k, i) => {
    const up = [...x];
    const dn = [...x];
    up[i] += h;
    dn[i] -= h;
    const curv = (f(up) - 2 * value + f(dn)) / (h * h);
    logSd[k] = Math.min(PRIOR_SD[k], curv > 0 ? 1 / Math.sqrt(curv) : PRIOR_SD[k]);
  });

  const params = obj.toParams(x);
  return { params, logSd, ...obj.stats(params), evals: obj.evals, from, to };
}
