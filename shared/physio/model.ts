/**
 * Physiological glucose model shared by the synthetic "true" patients and by each patient's twin.
 *
 * A Bergman-style minimal model with a simple pancreas, extended with the inputs this prototype
 * cares about:
 *   dG/dt = −SG·(G − Gset(t)) − X·G + Ra(t) − Uwalk(t)
 *   dX/dt = −p2·X + p2·SI_eff(t)·(I − Ib)
 *   dI/dt = −n·(I − Ib_eff(t)) + γ_eff(t)·max(0, G − h)
 * where Ra is gut glucose appearance from meals (fast and slow components), Gset is the
 * hepatic set point (basal glucose, lowered by metformin, raised at dawn and in illness),
 * Uwalk is insulin-independent uptake during and for hours after a walk, and SI_eff carries
 * the walk, sleep and illness effects on insulin sensitivity.
 *
 * Times are epoch minutes. Integration is explicit Euler with a 1-minute step.
 */
import type { TwinEvent } from './events';

export interface PhysioParams {
  /** Basal glucose set point without medication, mg/dL. */
  Gb: number;
  /** Glucose effectiveness, 1/min. */
  SG: number;
  /** Insulin sensitivity, (1/min) per µU/mL. */
  SI: number;
  /** Remote insulin action decay, 1/min. */
  p2: number;
  /** Insulin clearance, 1/min. */
  n: number;
  /** Basal insulin, µU/mL. */
  Ib: number;
  /** Secretion gain, µU/mL/min per mg/dL above threshold. */
  gamma: number;
  /** Secretion threshold, mg/dL. */
  h: number;
  /** Glucose appearance per gram of carbohydrate, mg/dL per g. */
  carbGain: number;
  /** Time to peak absorption for a medium-speed meal, minutes. */
  tmax: number;
  /** Fraction of meal carbohydrate absorbed slowly (fat/protein-delayed), 0–1. */
  slowFrac: number;
  /** Time to peak of the slow component, minutes. */
  tmaxSlow: number;
  /** Insulin-independent uptake while walking, mg/dL/min at G = 100 and intensity 1. */
  walkAcute: number;
  /** Delayed post-walk uptake (glycogen repletion), mg/dL/min per unit of delayed walk load. */
  walkLate: number;
  /** Decay time of the post-walk effect, minutes. */
  walkTau: number;
  /** Fractional insulin-sensitivity boost per unit of walk load. */
  walkSI: number;
  /** Set-point reduction at peak effect of 500 mg metformin, mg/dL. */
  metEffect: number;
  /** Fractional insulin-sensitivity loss per hour of sleep below 7 h. */
  sleepSens: number;
  /** Dawn rise of the set point (04:00–08:00), mg/dL. */
  dawn: number;
  /** Secretion boost at peak sulfonylurea effect (fraction). */
  suEffect: number;
}

/** Population-typical values for a person with type 2 diabetes (synthetic, uncalibrated). */
export const POPULATION: PhysioParams = {
  Gb: 132,
  SG: 0.010,
  SI: 3.2e-4,
  p2: 0.025,
  n: 0.12,
  Ib: 12,
  gamma: 0.0045,
  h: 110,
  carbGain: 4.2,
  tmax: 55,
  slowFrac: 0.3,
  tmaxSlow: 240,
  walkAcute: 0.4,
  walkLate: 0.6,
  walkTau: 360,
  walkSI: 0.55,
  metEffect: 24,
  sleepSens: 0.06,
  dawn: 14,
  suEffect: 1.4,
};

export interface PhysioState {
  G: number;
  X: number;
  I: number;
  /** Recent walk load (fills while walking, empties into B over ~90 min). */
  A: number;
  /** Delayed post-walk load (glycogen repletion), decays with walkTau. */
  B: number;
}

export function steadyState(p: PhysioParams, gset = p.Gb): PhysioState {
  return { G: gset, X: 0, I: p.Ib, A: 0, B: 0 };
}

/* ---------------- Inputs precomputed over a time window ---------------- */

const LN2 = Math.log(2);
/** Transit time from recent to delayed walk load, minutes. */
const WALK_TRANSIT = 90;

/** One-compartment oral PK with first-order absorption, normalised to a peak of 1. */
function pkShape(ka: number, ke: number) {
  const tPeak = Math.log(ka / ke) / (ka - ke);
  const peak = Math.exp(-ke * tPeak) - Math.exp(-ka * tPeak);
  return (tau: number) => (tau < 0 ? 0 : (Math.exp(-ke * tau) - Math.exp(-ka * tau)) / peak);
}
const metforminPK = pkShape(1 / 70, LN2 / 360);
const sulfonylureaPK = pkShape(1 / 90, LN2 / 420);

/* Meal absorption follows a Gamma(2) density with time-to-peak tp: τ/tp² · e^(−τ/tp), integrating to 1. */

const IST = 330;
const minuteOfDay = (t: number) => (((t + IST) % 1440) + 1440) % 1440;

/** Smooth 0→1→0 bump between 04:00 and 09:00, peaking about 07:00. */
function dawnShape(t: number) {
  const m = minuteOfDay(t);
  if (m < 240 || m > 540) return 0;
  return Math.sin(((m - 240) / 300) * Math.PI) ** 2;
}

export interface Inputs {
  t0: number;
  len: number;
  /** Meal glucose appearance per minute, in grams/min of carbohydrate (before carbGain). */
  raFast: Float64Array;
  raSlow: Float64Array;
  walk: Float64Array;
  met: Float64Array;
  su: Float64Array;
  dawn: Float64Array;
  /** Hours of sleep below 7 the night before (sleep-deficit effect). */
  sleepDebt: Float64Array;
  illness: Float64Array;
  /** Day-to-day insulin-sensitivity multiplier (truth simulation only; 1 for the twin). */
  siDay: Float64Array;
  /** Meal absorption speeds per meal (to recompute appearance when tmax changes). */
  meals: { t: number; carbs: number; speed: number }[];
}

/**
 * Turns an event list into per-minute input arrays over [t0, t0 + len).
 * Meal appearance depends on tmax/tmaxSlow, so it is filled by `fillMeals`.
 */
export function buildInputs(events: readonly TwinEvent[], t0: number, len: number): Inputs {
  const inp: Inputs = {
    t0,
    len,
    raFast: new Float64Array(len),
    raSlow: new Float64Array(len),
    walk: new Float64Array(len),
    met: new Float64Array(len),
    su: new Float64Array(len),
    dawn: new Float64Array(len),
    sleepDebt: new Float64Array(len),
    illness: new Float64Array(len),
    siDay: new Float64Array(len).fill(1),
    meals: [],
  };
  for (let i = 0; i < len; i++) inp.dawn[i] = dawnShape(t0 + i);

  const sleeps = events.filter((e) => e.kind === 'sleep').sort((a, b) => a.t - b.t);
  for (const e of events) {
    switch (e.kind) {
      case 'meal':
        inp.meals.push({ t: e.t, carbs: e.carbs, speed: e.speed ?? 1 });
        break;
      case 'walk': {
        const from = Math.max(0, e.t - t0);
        const to = Math.min(len, e.t + e.duration - t0);
        for (let i = from; i < to; i++) inp.walk[i] += e.intensity ?? 1;
        break;
      }
      case 'med': {
        const shape = e.drug === 'metformin' ? metforminPK : e.drug === 'glimepiride' ? sulfonylureaPK : null;
        const target = e.drug === 'metformin' ? inp.met : e.drug === 'glimepiride' ? inp.su : null;
        if (!shape || !target) break;
        const scale = e.drug === 'metformin' ? e.dose / 500 : e.dose / 1;
        const from = Math.max(0, e.t - t0);
        const to = Math.min(len, e.t - t0 + 2880);
        for (let i = from; i < to; i++) target[i] += scale * shape(t0 + i - e.t);
        break;
      }
      case 'illness': {
        const from = Math.max(0, e.t - t0);
        const to = Math.min(len, e.t + e.duration - t0);
        for (let i = from; i < to; i++) inp.illness[i] = Math.max(inp.illness[i], e.severity);
        break;
      }
      case 'sleep':
        break;
    }
  }
  // Sleep debt applies from waking until the next sleep starts.
  for (let k = 0; k < sleeps.length; k++) {
    const s = sleeps[k];
    if (s.kind !== 'sleep') continue;
    const debt = Math.max(0, 7 - s.duration / 60);
    const wake = s.t + s.duration;
    const next = sleeps[k + 1]?.t ?? wake + 1440;
    const from = Math.max(0, wake - t0);
    const to = Math.min(len, next - t0);
    for (let i = from; i < to; i++) inp.sleepDebt[i] = debt;
  }
  return inp;
}

/**
 * Fills meal appearance arrays for the given absorption times.
 * Uses the recurrence e^(−(τ+1)/tp) = e^(−τ/tp)·e^(−1/tp) instead of calling exp() per minute.
 */
export function fillMeals(inp: Inputs, tmax: number, tmaxSlow: number, slowFrac: number) {
  const { raFast, raSlow, t0, len } = inp;
  raFast.fill(0);
  raSlow.fill(0);
  const qs = Math.exp(-1 / tmaxSlow);
  const cs = 1 / (tmaxSlow * tmaxSlow);
  for (const m of inp.meals) {
    const tp = tmax / m.speed;
    const qf = Math.exp(-1 / tp);
    const cf = 1 / (tp * tp);
    const fast = m.carbs * (1 - slowFrac);
    const slow = m.carbs * slowFrac;
    const start = Math.max(0, m.t - t0);
    const end = Math.min(len, m.t - t0 + 900);
    if (start >= end) continue;
    let tau = t0 + start - m.t;
    let ef = Math.exp(-tau / tp);
    let es = Math.exp(-tau / tmaxSlow);
    for (let i = start; i < end; i++, tau++) {
      if (tau > 0) {
        raFast[i] += fast * tau * cf * ef;
        raSlow[i] += slow * tau * cs * es;
      }
      ef *= qf;
      es *= qs;
    }
  }
}

/** Effective set point and sensitivity at minute index i (exposed for explanations). */
export function setPoint(p: PhysioParams, inp: Inputs, i: number) {
  return p.Gb - p.metEffect * inp.met[i] + p.dawn * inp.dawn[i] + 35 * inp.illness[i];
}

export interface SimResult {
  /** Glucose per minute over the window. */
  G: Float64Array;
  final: PhysioState;
}

/**
 * Integrates the model over the input window from `init`.
 * `nudge` optionally pulls G toward observations (a simple state observer for the twin).
 */
export function simulate(
  p: PhysioParams,
  inp: Inputs,
  init: PhysioState,
  opts: { processNoise?: (i: number) => number; nudge?: { at: Float64Array; gain: number } } = {},
): SimResult {
  const len = inp.len;
  const out = new Float64Array(len);
  let { G, X, I, A, B } = init;
  const { processNoise, nudge } = opts;
  // Hoisted for speed: this loop runs thousands of times per fit.
  const { SI, SG, p2, n, Ib, gamma, h, carbGain, walkAcute, walkLate, walkTau, walkSI, sleepSens, suEffect, Gb, metEffect, dawn } = p;
  const { raFast, raSlow, walk, met, su, dawn: dawnIn, sleepDebt, illness, siDay } = inp;
  const p2SI = p2 * SI;
  for (let i = 0; i < len; i++) {
    const walking = walk[i];
    const ill = illness[i];
    let sleepF = 1 - sleepSens * sleepDebt[i];
    if (sleepF < 0.3) sleepF = 0.3;
    const SIrel = siDay[i] * (1 + walkSI * (A + B)) * sleepF * (1 - 0.45 * ill);
    const gset = Gb - metEffect * met[i] + dawn * dawnIn[i] + 35 * ill;
    const sui = su[i];
    const gammaEff = gamma * (1 + suEffect * sui);
    const IbEff = Ib * (1 + 0.5 * suEffect * sui);
    const Ra = carbGain * (raFast[i] + raSlow[i]);
    const Uwalk = (walkAcute * walking + walkLate * B) * G * 0.01;
    const above = G - h;

    const dG = -SG * (G - gset) - X * G + Ra - Uwalk;
    const dX = -p2 * X + p2SI * SIrel * (I - Ib);
    const dI = -n * (I - IbEff) + (above > 0 ? gammaEff * above : 0);
    const dA = walking / 30 - A / WALK_TRANSIT;
    const dB = A / WALK_TRANSIT - B / walkTau;

    G += dG;
    if (processNoise) G += processNoise(i);
    if (G < 30) G = 30;
    X += dX;
    I += dI;
    if (I < 0) I = 0;
    A += dA;
    if (A < 0) A = 0;
    B += dB;
    if (B < 0) B = 0;
    if (nudge) {
      const obs = nudge.at[i];
      if (obs === obs) G += nudge.gain * (obs - G);
    }
    out[i] = G;
  }
  return { G: out, final: { G, X, I, A, B } };
}

/** Convenience: build inputs, fill meals and simulate in one call. */
export function run(p: PhysioParams, events: readonly TwinEvent[], t0: number, len: number, init?: PhysioState) {
  const inp = buildInputs(events, t0, len);
  fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  return { inp, ...simulate(p, inp, init ?? steadyState(p, setPoint(p, inp, 0))) };
}
