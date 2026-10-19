/**
 * The patient's usual day, learned from their own logs: typical meal times and sizes,
 * recurring doses, sleep and evening walks. The twin uses it to expect tomorrow's breakfast
 * and morning dose, to spot missed doses and to compare tonight with "usual".
 */
import type { Drug, MealEvent, MedEvent, TwinEvent } from '../physio/events';
import { istMidnight, minuteOfDayIST } from '../time';

export type MealSlot = 'breakfast' | 'lunch' | 'tea' | 'dinner';

export interface RoutineMeal {
  slot: MealSlot;
  /** Minute of day (IST). */
  at: number;
  carbs: number;
  speed: number;
  days: number;
}

export interface RoutineDose {
  slot: 'morning' | 'evening';
  at: number;
  drug: Drug;
  dose: number;
  days: number;
}

export interface LearnedRoutine {
  days: number;
  meals: RoutineMeal[];
  doses: RoutineDose[];
  sleepAt: number | null;
  sleepHours: number | null;
  /** Share of days with a walk between 17:00 and 23:00. */
  eveningWalkRate: number;
  eveningWalkMinutes: number;
}

export function mealSlot(minuteOfDay: number): MealSlot | null {
  const h = minuteOfDay / 60;
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15.5) return 'lunch';
  if (h >= 15.5 && h < 18.5) return 'tea';
  if (h >= 18.5 && h < 23.5) return 'dinner';
  return null;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function learnRoutine(events: readonly TwinEvent[], from: number, to: number): LearnedRoutine {
  const inWin = events.filter((e) => e.t >= from && e.t < to);
  const days = Math.max(1, Math.round((to - from) / 1440));

  const bySlot = new Map<MealSlot, MealEvent[]>();
  for (const e of inWin) {
    if (e.kind !== 'meal' || e.source === 'inferred' || e.source === 'suggested') continue;
    const slot = mealSlot(minuteOfDayIST(e.t));
    if (!slot) continue;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot)!.push(e);
  }
  const meals: RoutineMeal[] = [];
  for (const slot of ['breakfast', 'lunch', 'tea', 'dinner'] as const) {
    const ms = bySlot.get(slot) ?? [];
    const dayCount = new Set(ms.map((m) => istMidnight(m.t))).size;
    if (dayCount < days * 0.4) continue;
    meals.push({
      slot,
      at: Math.round(median(ms.map((m) => minuteOfDayIST(m.t)))),
      carbs: Math.round(median(ms.map((m) => m.carbs))),
      speed: median(ms.map((m) => m.speed ?? 1)),
      days: dayCount,
    });
  }

  const doseGroups = new Map<string, MedEvent[]>();
  for (const e of inWin) {
    if (e.kind !== 'med') continue;
    const slot = minuteOfDayIST(e.t) < 720 ? 'morning' : 'evening';
    const key = `${e.drug}:${slot}`;
    if (!doseGroups.has(key)) doseGroups.set(key, []);
    doseGroups.get(key)!.push(e);
  }
  const doses: RoutineDose[] = [];
  for (const [key, ds] of doseGroups) {
    const [drug, slot] = key.split(':') as [Drug, 'morning' | 'evening'];
    const dayCount = new Set(ds.map((d) => istMidnight(d.t))).size;
    // A medicine started recently counts as recurring once it has been taken on most days since.
    const firstDay = istMidnight(Math.min(...ds.map((d) => d.t)));
    const span = Math.max(1, Math.round((to - firstDay) / 1440));
    if (dayCount < Math.min(days, span) * 0.5) continue;
    doses.push({ slot, drug, at: Math.round(median(ds.map((d) => minuteOfDayIST(d.t)))), dose: median(ds.map((d) => d.dose)), days: dayCount });
  }

  const sleeps = inWin.filter((e) => e.kind === 'sleep');
  const walks = inWin.filter((e) => e.kind === 'walk' && minuteOfDayIST(e.t) >= 17 * 60);
  const walkDays = new Set(walks.map((w) => istMidnight(w.t))).size;
  return {
    days,
    meals,
    doses,
    sleepAt: sleeps.length ? Math.round(median(sleeps.map((s) => (minuteOfDayIST(s.t) + 720) % 1440)) - 720 + 1440) % 1440 : null,
    sleepHours: sleeps.length ? median(sleeps.map((s) => (s.kind === 'sleep' ? s.duration : 0))) / 60 : null,
    eveningWalkRate: walkDays / days,
    eveningWalkMinutes: walks.length ? Math.round(median(walks.map((w) => (w.kind === 'walk' ? w.duration : 0)))) : 0,
  };
}

/** Routine events expected in (from, to] that have not been logged yet. */
export function expectedEvents(r: LearnedRoutine, logged: readonly TwinEvent[], from: number, to: number): TwinEvent[] {
  const out: TwinEvent[] = [];
  for (let day = istMidnight(from); day <= to; day += 1440) {
    for (const m of r.meals) {
      const t = day + m.at;
      if (t <= from || t > to) continue;
      const already = logged.some((e) => e.kind === 'meal' && Math.abs(e.t - t) < 120);
      if (!already) out.push({ kind: 'meal', t, carbs: m.carbs, speed: m.speed, label: `Usual ${m.slot}`, source: 'planned' });
    }
    for (const d of r.doses) {
      const t = day + d.at;
      if (t <= from || t > to) continue;
      const already = logged.some((e) => e.kind === 'med' && e.drug === d.drug && Math.abs(e.t - t) < 180);
      if (!already) out.push({ kind: 'med', t, drug: d.drug, dose: d.dose, source: 'planned' });
    }
  }
  return out;
}
