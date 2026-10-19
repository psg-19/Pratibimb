/**
 * Builds a synthetic evening from the patient's learned routine, so the twin can be asked
 * "what if" questions about dinner, walks, sleep and doses without touching real data.
 */
import type { TwinEvent } from '../physio/events';
import { istTime } from '../time';
import type { LearnedRoutine } from './routine';

export interface EveningPlan {
  /** Dinner carbohydrate, g, and absorption speed. */
  carbs: number;
  speed: number;
  /** Walk after dinner, minutes (starts 35 minutes after the meal). */
  walk: number;
  /** Sleep the night before, hours. */
  sleep: number;
  /** Evening dose(s) taken. */
  eveningDose: boolean;
}

/** An IST-aligned reference day for hypothetical evenings (dawn effects depend on clock time). */
export const SCENARIO_DAY = istTime(2026, 1, 3, 0, 0);

/** Events for a routine day whose dinner, walk, sleep and evening dose follow `plan`. */
export function eveningEvents(r: LearnedRoutine, plan: EveningPlan, dayStart: number) {
  const ev: TwinEvent[] = [];
  const dinnerAt = r.meals.find((m) => m.slot === 'dinner')?.at ?? 20 * 60 + 15;
  const wake = 6 * 60 + 30;
  ev.push({ kind: 'sleep', t: dayStart + wake - Math.round(plan.sleep * 60), duration: Math.round(plan.sleep * 60) });
  for (const d of r.doses) {
    if (d.slot === 'evening' && !plan.eveningDose) continue;
    ev.push({ kind: 'med', t: dayStart + d.at, drug: d.drug, dose: d.dose });
    // Yesterday's evening dose still acts this morning.
    if (d.slot === 'evening') ev.push({ kind: 'med', t: dayStart - 1440 + d.at, drug: d.drug, dose: d.dose });
  }
  for (const m of r.meals) {
    if (m.slot === 'dinner') continue;
    ev.push({ kind: 'meal', t: dayStart + m.at, carbs: m.carbs, speed: m.speed });
  }
  const dinner = dayStart + dinnerAt;
  ev.push({ kind: 'meal', t: dinner, carbs: plan.carbs, speed: plan.speed });
  if (plan.walk > 0) ev.push({ kind: 'walk', t: dinner + 35, duration: plan.walk });
  return { events: ev, dinner };
}
