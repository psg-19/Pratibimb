/**
 * Synthetic patient history: routine events with day-to-day variability, simulated through the
 * persona's true physiology, observed by a CGM with lag, noise and occasional gaps.
 * The twin only sees what was logged (with carb-estimate errors); the truth sees everything.
 */
import type { TwinEvent } from '../physio/events';
import { buildInputs, fillMeals, POPULATION, simulate, steadyState, setPoint, type PhysioParams, type PhysioState } from '../physio/model';
import { hashSeed, rng, type Rng } from '../rng';
import { istMidnight } from '../time';
import type { Persona, ScenarioEvent } from './personas';

/** An event as stored: twin-visible fields plus truth-only extras. */
export type SynthEvent = TwinEvent & {
  /** Provenance for removing demo context when a real export replaces the sensor. */
  synthetic?: boolean;
  /** Actual carbohydrate (truth); `carbs` holds the logged estimate. */
  trueCarbs?: number;
  /** Not logged: used by the truth simulation only. */
  hidden?: boolean;
  note?: string;
};

export interface Reading {
  t: number;
  mgdl: number;
}

export interface TruthCheckpoint {
  t: number;
  state: PhysioState;
  /** Interstitial (sensor-side) glucose, lagging plasma. */
  Gi: number;
}

export interface DailyVitals {
  day: number;
  steps: number;
  restingHr: number;
}

export interface History {
  params: PhysioParams;
  events: SynthEvent[];
  readings: Reading[];
  checkpoint: TruthCheckpoint;
  vitals: DailyVitals[];
  sensorEnd: number | null;
}

const at = (dayStart: number, [h, m]: readonly [number, number], jitter = 0) => dayStart + h * 60 + m + jitter;
const round5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);

/** Day-to-day insulin-sensitivity variation of the true patient (deterministic per day). */
export function siForDay(seed: number, dayStart: number) {
  const r = rng(hashSeed(`${seed}:${dayStart}`));
  return Math.exp(0.08 * r.normal());
}

function routineDay(p: Persona, k: number, dayStart: number, r: Rng, out: SynthEvent[]) {
  const R = p.routine;
  const slots = [
    ['breakfast', R.breakfast],
    ['lunch', R.lunch],
    ['tea', R.tea],
    ['dinner', R.dinner],
  ] as const;
  for (const [, s] of slots) {
    const trueCarbs = Math.round(r.range(s.carbs[0], s.carbs[1]));
    const logged = r.chance(R.logProb);
    out.push({
      kind: 'meal',
      t: at(dayStart, s.at, Math.round(r.range(-s.jitter, s.jitter))),
      carbs: round5(trueCarbs * Math.exp(R.carbError * r.normal())),
      trueCarbs,
      speed: s.speed * r.range(0.9, 1.1),
      label: r.pick(s.labels),
      source: r.chance(0.5) ? 'photo' : 'logged',
      hidden: !logged,
    });
  }
  // An occasional unlogged snack.
  if (r.chance(0.2)) {
    const trueCarbs = Math.round(r.range(10, 25));
    out.push({ kind: 'meal', t: at(dayStart, [11, 0], Math.round(r.range(0, 120))), carbs: trueCarbs, trueCarbs, speed: 1.4, label: 'Snack', hidden: true });
  }
  for (const w of R.walks) {
    if (r.chance(w.prob)) {
      const duration = Math.round(r.range(w.minutes[0], w.minutes[1]));
      out.push({ kind: 'walk', t: at(dayStart, w.at, Math.round(r.range(-20, 20))), duration, steps: duration * 95, source: 'device' });
    }
  }
  R.meds.forEach((m, i) => {
    const slot = m.at[0] < 12 ? 'morning' : 'evening';
    if (p.skips?.includes(`${k}:med-${slot}`)) return;
    if (!r.chance(m.adherence)) return;
    out.push({ kind: 'med', t: at(dayStart, m.at, Math.round(r.range(-10, 15)) + i), drug: m.drug, dose: m.dose, source: 'logged' });
  });
  for (const s of p.starts ?? []) {
    if (k >= s.fromDay) out.push({ kind: 'med', t: at(dayStart, s.at, Math.round(r.range(-5, 10))), drug: s.drug, dose: s.dose, source: 'logged' });
  }
}

function scenarioEvent(e: ScenarioEvent, dayStart: number): SynthEvent {
  const t = at(dayStart + (e.day ?? 0) * 1440, e.at);
  switch (e.kind) {
    case 'meal':
      return { kind: 'meal', t, carbs: e.carbs!, trueCarbs: e.trueCarbs ?? e.carbs, speed: e.speed, label: e.label, source: e.source, note: e.note, hidden: e.hidden };
    case 'walk':
      return { kind: 'walk', t, duration: e.duration!, steps: e.steps, source: e.source };
    case 'med':
      return { kind: 'med', t, drug: e.drug!, dose: e.dose!, source: e.source };
    case 'sleep':
      return { kind: 'sleep', t, duration: e.duration!, source: e.source };
    case 'illness':
      return { kind: 'illness', t, duration: e.duration!, severity: e.severity!, label: e.label, source: e.source };
  }
}

/** A normal simulated day after the initial demonstration scenario has ended. */
export function generateRoutineDay(p: Persona, day: number, seed: number): SynthEvent[] {
  const r = rng(hashSeed(`${seed}:routine:${day}`));
  const out: SynthEvent[] = [{ kind: 'sleep', t: at(day, p.routine.sleepAt), duration: Math.round(r.range(...p.routine.sleepHours) * 60), source: 'device' }];
  routineDay({ ...p, skips: [] }, 0, day, r, out);
  return out.map((e) => ({ ...e, synthetic: true })).sort((a, b) => a.t - b.t);
}

/** Builds the persona's events from `days` before the demo day to `futureDays` after it. */
export function buildEvents(p: Persona, now: number, seed: number, days = 21, futureDays = 2): SynthEvent[] {
  const r = rng(seed);
  const today = istMidnight(now);
  const out: SynthEvent[] = [];
  const hasScenario = p.scenario.length > 0;
  const scenarioSleepDays = new Set(p.scenario.filter((e) => e.kind === 'sleep').map((e) => e.day ?? 0));

  for (let k = -(days + 2); k <= futureDays; k++) {
    const dayStart = today + k * 1440;
    // Sleep that starts this evening.
    if (!scenarioSleepDays.has(k)) {
      const dur = Math.round(r.range(p.routine.sleepHours[0], p.routine.sleepHours[1]) * 60);
      out.push({ kind: 'sleep', t: at(dayStart, p.routine.sleepAt, Math.round(r.range(-25, 30))), duration: dur, source: 'device' });
    }
    if (k === 0 && hasScenario) continue;
    routineDay(p, k, dayStart, r, out);
  }
  if (hasScenario) {
    // The demo day follows the scenario, plus routine events still to come tonight.
    for (const e of p.scenario) out.push(scenarioEvent(e, today));
    // Medicines that start mid-history still apply on the demo day if the scenario lists them.
  }
  return out.map((e) => ({ ...e, synthetic: true })).sort((a, b) => a.t - b.t);
}

/** The event list as the truth simulation sees it (true carbs, hidden events included). */
export function truthEvents(events: readonly SynthEvent[]): TwinEvent[] {
  return events.map((e) => (e.kind === 'meal' ? { ...e, carbs: e.trueCarbs ?? e.carbs } : e));
}

/** CGM sensor: first-order lag (~8 min) plus noise; deterministic per patient and minute. */
function sensorStep(Gi: number, G: number) {
  return Gi + (G - Gi) / 8;
}
function white(seed: number, t: number) {
  return rng(hashSeed(`${seed}:n:${t}`)).normal();
}
/**
 * CGM error drifts slowly rather than jumping each reading: an AR(1)-like sum of the last few
 * readings' innovations (weights 0.7^k, normalised to unit variance), scaled with glucose.
 */
function sensorNoise(seed: number, t: number, Gi: number) {
  let s = 0;
  let w2 = 0;
  for (let k = 0; k < 6; k++) {
    const w = 0.7 ** k;
    s += w * white(seed, t - 5 * k);
    w2 += w * w;
  }
  return (s / Math.sqrt(w2)) * (1.5 + 0.015 * Gi);
}
/** Deterministic short dropouts (≈ 2 a week, 30–75 min). */
export function inGap(seed: number, t: number) {
  const block = Math.floor(t / 1440 / 3.5);
  const r = rng(hashSeed(`${seed}:gap:${block}`));
  const start = block * 1440 * 3.5 + r.range(0, 1440 * 3.5);
  return t >= start && t < start + r.range(30, 75);
}

/**
 * Simulates the true patient from a checkpoint to `to`, returning new CGM readings (every
 * 5 minutes) and the new checkpoint. Used both for the backfill and for live ticks.
 */
export function advanceTruth(
  params: PhysioParams,
  events: readonly SynthEvent[],
  from: TruthCheckpoint,
  to: number,
  seed: number,
  sensorEnd: number | null = null,
): { readings: Reading[]; checkpoint: TruthCheckpoint; G: Float64Array } {
  const len = to - from.t;
  if (len <= 0) return { readings: [], checkpoint: from, G: new Float64Array(0) };
  const inp = buildInputs(truthEvents(events), from.t, len);
  fillMeals(inp, params.tmax, params.tmaxSlow, params.slowFrac);
  let day = -1;
  let si = 1;
  for (let i = 0; i < len; i++) {
    const d = istMidnight(from.t + i);
    if (d !== day) {
      day = d;
      si = siForDay(seed, d);
    }
    inp.siDay[i] = si;
  }
  const noise = rng(hashSeed(`${seed}:p:${from.t}`));
  const sim = simulate(params, inp, from.state, { processNoise: () => 0.2 * noise.normal() });
  const readings: Reading[] = [];
  let Gi = from.Gi;
  for (let i = 0; i < len; i++) {
    const t = from.t + i;
    Gi = sensorStep(Gi, sim.G[i]);
    if ((t + 1) % 5 === 0) {
      const rt = t + 1;
      if ((sensorEnd == null || rt < sensorEnd) && !inGap(seed, rt)) {
        readings.push({ t: rt, mgdl: Math.round(Math.min(400, Math.max(40, Gi + sensorNoise(seed, rt, Gi)))) });
      }
    }
  }
  return { readings, checkpoint: { t: to, state: sim.final, Gi }, G: sim.G };
}

/** Full backfill: events, truth simulation and CGM readings from `days` ago until `now`. */
export function generateHistory(p: Persona, now: number, opts: { days?: number; seed?: number } = {}): History {
  const days = opts.days ?? 21;
  const seed = opts.seed ?? hashSeed(p.id);
  const params: PhysioParams = { ...POPULATION, ...p.truth };
  const events = buildEvents(p, now, seed, days);
  const today = istMidnight(now);
  const t0 = today - (days + 2) * 1440;
  const historyStart = today - days * 1440;
  const sensorEnd = p.sensorExpires ? today + p.sensorExpires[0] * 1440 + p.sensorExpires[1] * 60 + p.sensorExpires[2] : null;

  // Burn in from steady state, then keep readings from the history start onwards.
  const inp0 = buildInputs(truthEvents(events), t0, 1);
  const start: TruthCheckpoint = { t: t0, state: steadyState(params, setPoint(params, inp0, 0)), Gi: params.Gb };
  const sim = advanceTruth(params, events, start, now, seed, sensorEnd);
  const readings = sim.readings.filter((x) => x.t >= historyStart);

  const r = rng(hashSeed(`${seed}:vitals`));
  const vitals: DailyVitals[] = [];
  for (let k = -days; k <= 0; k++) {
    const dayStart = today + k * 1440;
    const walkSteps = events
      .filter((e) => e.kind === 'walk' && e.t >= dayStart && e.t < dayStart + 1440 && e.t < now)
      .reduce((a, e) => a + (e.kind === 'walk' ? (e.steps ?? e.duration * 95) : 0), 0);
    vitals.push({
      day: dayStart,
      steps: Math.round(p.routine.baseSteps * r.range(0.75, 1.25) * (k === 0 ? 0.55 : 1) + walkSteps),
      restingHr: Math.round(p.routine.restingHr + r.normal() * 2.2),
    });
  }
  return { params, events, readings, checkpoint: sim.checkpoint, vitals, sensorEnd };
}
