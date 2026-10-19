/**
 * Builds (or re-fits) a patient's twin from their data:
 * detect unlogged meals → fit → re-detect with the fitted twin → refine → learn the routine →
 * back-test on recent evenings (self-calibration) → read off what the twin has learned.
 */
import type { MealEvent, TwinEvent } from '../physio/events';
import { POPULATION, type PhysioParams } from '../physio/model';
import { calibrate, type Calibration } from './calibrate';
import { detectUnloggedMeals } from './detect';
import { fitTwin, type FitKey, type Observation } from './fit';
import { learnedInsights, type Insight } from './insights';
import { learnRoutine, type LearnedRoutine } from './routine';

export interface TwinBuildInput {
  /** Events the patient logged or devices reported (no inferred meals). */
  events: TwinEvent[];
  readings: Observation[];
  now: number;
  /** Last fit, for a warm start. */
  previous?: PhysioParams;
  pronoun?: 'he' | 'she' | 'they';
  days?: number;
}

export interface TwinModelData {
  params: PhysioParams;
  logSd: Record<FitKey, number>;
  fit: { rmse: number; mard: number; n: number; from: number; to: number; evals: number; days: number; ms: number };
  calibration: Calibration;
  routine: LearnedRoutine;
  insights: Insight[];
  inferred: MealEvent[];
}

export function buildTwin(input: TwinBuildInput): TwinModelData {
  const started = Date.now();
  const { now, readings } = input;
  const days = input.days ?? 14;
  const visible = input.events.filter((e) => e.t <= now);
  const firstReading = readings.length ? readings[0].t : now;
  const from = Math.max(firstReading, now - days * 1440);
  const to = now;
  const start = input.previous ?? POPULATION;

  const inferred1 = detectUnloggedMeals(start, visible, readings, { from, to });
  const fit1 = fitTwin([...visible, ...inferred1], readings, {
    from,
    to,
    init: input.previous,
    maxEvals: input.previous ? 1200 : 2000,
    restarts: input.previous ? 1 : 2,
    stepScale: input.previous ? 0.3 : 0.6,
  });
  const inferred = detectUnloggedMeals(fit1.params, visible, readings, { from, to });
  const fit = fitTwin([...visible, ...inferred], readings, { from, to, init: fit1.params, maxEvals: 1200, restarts: 1, stepScale: 0.3 });
  const routine = learnRoutine(visible, from, to);
  const calibration = calibrate(fit.params, [...visible, ...inferred], readings, now, { nights: Math.min(10, Math.floor((to - from) / 1440) - 1) });
  const insights = learnedInsights(fit.params, routine, input.pronoun);
  return {
    params: fit.params,
    logSd: fit.logSd,
    fit: { rmse: fit.rmse, mard: fit.mard, n: fit.n, from, to, evals: fit1.evals + fit.evals, days: Math.round((to - from) / 1440), ms: Date.now() - started },
    calibration,
    routine,
    insights,
    inferred,
  };
}
