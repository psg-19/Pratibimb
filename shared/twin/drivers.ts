/**
 * "Why the twin thinks so": counterfactual attribution. For each recent event that could
 * plausibly move tonight's glucose, the twin replays the evening with that one thing changed
 * (dinner at its usual size, no walk, no dose, the missed dose taken, a full night's sleep …)
 * and measures how much the forecast low (or time spent high) moves. The largest effects are
 * the drivers, each with its size in mg/dL or minutes.
 */
import type { TwinEvent } from '../physio/events';
import { buildInputs, fillMeals, simulate, type PhysioParams } from '../physio/model';
import { clockIST, istMidnight, minuteOfDayIST } from '../time';
import type { Observation } from './fit';
import { estimateState } from './forecast';
import { expectedEvents, mealSlot, type LearnedRoutine } from './routine';

export type Pronoun = 'he' | 'she' | 'they';
const POSS: Record<Pronoun, string> = { he: 'his', she: 'her', they: 'their' };

export type DriverKind =
  | 'lighter-meal'
  | 'heavier-meal'
  | 'walk'
  | 'dose-taken'
  | 'dose-missed'
  | 'sugary-meal'
  | 'illness'
  | 'short-sleep'
  | 'new-medicine'
  | 'early-dinner';

export interface Driver {
  kind: DriverKind;
  text: string;
  /** Effect on the risk metric: mg/dL of the forecast low, or minutes above 180. */
  effect: number;
  unit: 'mg/dL' | 'min';
}

export type RiskDirection = 'low' | 'high';

interface Candidate {
  kind: DriverKind;
  text: string;
  edit: (events: TwinEvent[]) => TwinEvent[];
  /** Earliest time the edit touches (open-loop replay starts before it). */
  at: number;
}

const DRUG_NAME = { metformin: 'Metformin', glimepiride: 'Glimepiride', sitagliptin: 'Sitagliptin' } as const;
const round5 = (x: number) => Math.round(x / 5) * 5;

function candidates(events: readonly TwinEvent[], routine: LearnedRoutine, now: number, pronoun: Pronoun, firstDoses?: Record<string, number>): Candidate[] {
  const poss = POSS[pronoun];
  const out: Candidate[] = [];
  const recent = events.filter((e) => e.t > now - 12 * 60 && e.t <= now);
  const usual = (slot: string) => routine.meals.find((m) => m.slot === slot);

  const meals = recent.filter((e) => e.kind === 'meal' && e.source !== 'inferred');
  const dinner = [...meals].reverse().find((e) => mealSlot(minuteOfDayIST(e.t)) === 'dinner');
  const dinnerUsual = usual('dinner');
  if (dinner && dinner.kind === 'meal' && dinnerUsual) {
    const diff = dinnerUsual.carbs - dinner.carbs;
    if (diff >= 15) {
      out.push({
        kind: 'lighter-meal',
        text: `Dinner was about ${round5(diff)} g lighter in carbs than ${poss} usual`,
        at: dinner.t,
        edit: (ev) => ev.map((e) => (e === dinner ? { ...dinner, carbs: dinnerUsual.carbs } : e)),
      });
    } else if (diff <= -20) {
      out.push({
        kind: 'heavier-meal',
        text: `Dinner was about ${round5(-diff)} g heavier in carbs than ${poss} usual`,
        at: dinner.t,
        edit: (ev) => ev.map((e) => (e === dinner ? { ...dinner, carbs: dinnerUsual.carbs } : e)),
      });
    }
    const early = dinnerUsual.at - minuteOfDayIST(dinner.t);
    if (early >= 45) {
      out.push({
        kind: 'early-dinner',
        text: `Dinner logged at ${clockIST(dinner.t)}, earlier than usual`,
        at: dinner.t,
        edit: (ev) => ev.map((e) => (e === dinner ? { ...dinner, t: dinner.t + early } : e)),
      });
    }
  }

  for (const m of meals) {
    if (m.kind !== 'meal' || m === dinner || m.t < now - 5 * 60) continue;
    const slot = mealSlot(minuteOfDayIST(m.t));
    const u = slot ? usual(slot) : undefined;
    const sugary = (m.speed ?? 1) >= 1.4 && m.carbs >= 30;
    if (sugary || (u && m.carbs >= u.carbs + 25)) {
      out.push({
        kind: 'sugary-meal',
        text: `${m.label ?? 'A large meal'} logged at ${clockIST(m.t)}`,
        at: m.t,
        edit: (ev) => ev.filter((e) => e !== m),
      });
    }
  }

  for (const w of recent) {
    if (w.kind !== 'walk' || w.duration < 15 || w.t < now - 10 * 60) continue;
    const afterMeal = meals.some((m) => w.t - m.t >= 0 && w.t - m.t <= 90);
    const isDinner = dinner && w.t - dinner.t >= 0 && w.t - dinner.t <= 90;
    out.push({
      kind: 'walk',
      text: isDinner
        ? `A ${w.duration}-minute walk straight after dinner`
        : afterMeal
          ? `A ${w.duration}-minute walk straight after a meal`
          : `A ${w.duration}-minute walk at ${clockIST(w.t)}`,
      at: w.t,
      edit: (ev) => ev.filter((e) => e !== w),
    });
  }

  // When each medicine was first taken: from the full record if given, else from these events.
  const firstDose = new Map<string, number>(Object.entries(firstDoses ?? {}));
  for (const e of events) if (e.kind === 'med' && !firstDose.has(e.drug)) firstDose.set(e.drug, e.t);
  for (const d of recent) {
    if (d.kind !== 'med' || d.t < now - 10 * 60) continue;
    const started = firstDose.get(d.drug) ?? d.t;
    const daysOn = Math.round((istMidnight(now) - istMidnight(started)) / 1440);
    if (daysOn <= 7) {
      out.push({
        kind: 'new-medicine',
        text: `${DRUG_NAME[d.drug]} ${d.dose} mg started ${daysOn === 0 ? 'today' : daysOn === 1 ? 'yesterday' : `${daysOn} days ago`}`,
        at: d.t,
        edit: (ev) => ev.filter((e) => !(e.kind === 'med' && e.drug === d.drug && e.t > now - 30 * 60 * 24)),
      });
    } else if (d.drug === 'metformin') {
      out.push({
        kind: 'dose-taken',
        text: `${minuteOfDayIST(d.t) >= 720 ? 'Evening' : 'Morning'} metformin taken at ${clockIST(d.t)}`,
        at: d.t,
        edit: (ev) => ev.filter((e) => e !== d),
      });
    }
  }

  // Missed recurring doses: expected by the routine in the last 26 h, not logged.
  for (const dose of routine.doses) {
    let nights = 0;
    const missedTimes: number[] = [];
    for (let k = 0; k < 4; k++) {
      const t = istMidnight(now) - k * 1440 + dose.at;
      // Give a dose 30 minutes' grace before calling it missed.
      if (t > now - 30) continue;
      const taken = events.some((e) => e.kind === 'med' && e.drug === dose.drug && Math.abs(e.t - t) < 180);
      if (taken) break;
      nights++;
      missedTimes.push(t);
    }
    if (nights === 0 || missedTimes[0] < now - 26 * 60) continue;
    const when = dose.slot === 'evening' ? 'evening' : 'morning';
    const count = nights === 1 ? (when === 'evening' ? 'tonight' : 'today') : `for ${nights === 2 ? 'two' : nights === 3 ? 'three' : nights} ${when === 'evening' ? 'nights' : 'days'}`;
    out.push({
      kind: 'dose-missed',
      text: `No ${when} ${dose.drug} logged ${count}`,
      at: missedTimes[missedTimes.length - 1],
      edit: (ev) => [...ev, ...missedTimes.map((t) => ({ kind: 'med' as const, t, drug: dose.drug, dose: dose.dose }))],
    });
  }

  for (const e of events) {
    if (e.kind !== 'illness' || e.t > now || e.t + e.duration < now || e.t < now - 24 * 60) continue;
    out.push({ kind: 'illness', text: `${e.label ?? 'Illness'} logged at ${clockIST(e.t)}`, at: e.t, edit: (ev) => ev.filter((x) => x !== e) });
  }

  const lastSleep = [...events].reverse().find((e) => e.kind === 'sleep' && e.t + e.duration <= now && e.t > now - 30 * 60);
  if (lastSleep && lastSleep.kind === 'sleep' && lastSleep.duration < 6 * 60) {
    const h = Math.round((lastSleep.duration / 60) * 10) / 10;
    out.push({
      kind: 'short-sleep',
      text: `Slept ${Number.isInteger(h) ? h : h.toFixed(1)} hours last night`,
      at: lastSleep.t + lastSleep.duration,
      edit: (ev) => ev.map((e) => (e === lastSleep ? { ...lastSleep, duration: 450 } : e)),
    });
  }
  return out;
}

/** Open-loop replay from `start` to now + horizon; returns sensor-side glucose after now. */
function replay(p: PhysioParams, events: readonly TwinEvent[], readings: readonly Observation[], start: number, now: number, horizon: number) {
  const state = estimateState(p, events.filter((e) => e.t < start), readings, start);
  const len = now + horizon - start;
  const inp = buildInputs(events, start, len);
  fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  const sim = simulate(p, inp, state);
  return sim.G.subarray(now - start);
}

const metric = (g: Float64Array, dir: RiskDirection) => {
  if (dir === 'low') return Math.min(...g);
  let above = 0;
  for (let i = 0; i < g.length; i++) if (g[i] > 180) above++;
  return above;
};

export function attributeDrivers(opts: {
  params: PhysioParams;
  events: readonly TwinEvent[];
  readings: readonly Observation[];
  routine: LearnedRoutine;
  now: number;
  horizon?: number;
  direction: RiskDirection;
  pronoun?: Pronoun;
  max?: number;
  /** First dose of each drug across the whole record (to tell new medicines from old). */
  firstDoses?: Record<string, number>;
}): Driver[] {
  const { params, readings, routine, now, direction } = opts;
  const horizon = opts.horizon ?? 360;
  const expected = expectedEvents(routine, opts.events, now, now + horizon);
  const events = [...opts.events, ...expected];
  const cands = candidates(opts.events, routine, now, opts.pronoun ?? 'they', opts.firstDoses);
  if (cands.length === 0) return [];
  const start = Math.max(now - 26 * 60, Math.min(...cands.map((c) => c.at)) - 60);
  const base = metric(replay(params, events, readings, start, now, horizon), direction);
  const out: Driver[] = [];
  for (const c of cands) {
    const cf = metric(replay(params, c.edit([...events]), readings, start, now, horizon), direction);
    // Positive effect = this event pushes toward the risk.
    const effect = direction === 'low' ? cf - base : base - cf;
    if (effect >= (direction === 'low' ? 2 : 10)) out.push({ kind: c.kind, text: c.text, effect: Math.round(effect), unit: direction === 'low' ? 'mg/dL' : 'min' });
  }
  return out.sort((a, b) => b.effect - a.effect).slice(0, opts.max ?? 3);
}
