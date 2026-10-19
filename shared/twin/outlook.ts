/**
 * HbA1c outlook. "Now" is the glucose management indicator (GMI) from the last 14 days of CGM
 * (GMI % = 3.31 + 0.02392 × mean glucose in mg/dL). Projections play 14 routine days on the
 * twin — with and without the patient's usual evening walks — and convert their mean to GMI.
 */
import { buildInputs, fillMeals, simulate, steadyState, setPoint, type PhysioParams } from '../physio/model';
import type { TwinEvent } from '../physio/events';
import type { LearnedRoutine } from './routine';
import { SCENARIO_DAY } from './scenario';
import type { Observation } from './fit';

export const gmi = (meanMgdl: number) => 3.31 + 0.02392 * meanMgdl;

export function gmiFromReadings(readings: readonly Observation[], now: number, days = 14): { value: number; mean: number; n: number } | null {
  const rs = readings.filter((r) => r.t > now - days * 1440 && r.t <= now);
  if (rs.length < 288 * Math.min(days, 7)) return null;
  const mean = rs.reduce((a, r) => a + r.mgdl, 0) / rs.length;
  return { value: gmi(mean), mean, n: rs.length };
}

function routineDays(r: LearnedRoutine, days: number, walks: boolean): TwinEvent[] {
  const ev: TwinEvent[] = [];
  const walkDays = walks ? Math.round(days * r.eveningWalkRate) : 0;
  for (let d = -1; d < days; d++) {
    const day = SCENARIO_DAY + d * 1440;
    for (const m of r.meals) ev.push({ kind: 'meal', t: day + m.at, carbs: m.carbs, speed: m.speed });
    for (const x of r.doses) ev.push({ kind: 'med', t: day + x.at, drug: x.drug, dose: x.dose });
    if (r.sleepAt != null && r.sleepHours != null) ev.push({ kind: 'sleep', t: day + r.sleepAt, duration: Math.round(r.sleepHours * 60) });
    // Spread walk days evenly through the period.
    if (d >= 0 && walkDays > 0 && Math.floor(((d + 1) * walkDays) / days) > Math.floor((d * walkDays) / days)) {
      const dinner = r.meals.find((m) => m.slot === 'dinner')?.at ?? 20 * 60;
      ev.push({ kind: 'walk', t: day + dinner + 35, duration: r.eveningWalkMinutes || 25 });
    }
  }
  return ev;
}

export function projectGmi(p: PhysioParams, r: LearnedRoutine, scenario: 'keep' | 'stop', days = 14): number {
  const events = routineDays(r, days, scenario === 'keep');
  const t0 = SCENARIO_DAY - 1440;
  const len = (days + 1) * 1440;
  const inp = buildInputs(events, t0, len);
  fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  const G = simulate(p, inp, steadyState(p, setPoint(p, inp, 0))).G;
  let sum = 0;
  for (let i = 1440; i < len; i++) sum += G[i];
  return gmi(sum / (len - 1440));
}
