import { beforeAll, describe, expect, it } from 'vitest';
import type { TwinEvent } from '../shared/physio/events';
import { POPULATION, run, type PhysioParams } from '../shared/physio/model';
import { advanceTruth, generateHistory, type History } from '../shared/synth/generate';
import { PERSONAS } from '../shared/synth/personas';
import { hashSeed } from '../shared/rng';
import { clockIST, formatDuration, istMidnight, istTime, minuteOfDayIST } from '../shared/time';
import { calibrate } from '../shared/twin/calibrate';
import { detectUnloggedMeals } from '../shared/twin/detect';
import { attributeDrivers } from '../shared/twin/drivers';
import { forecast } from '../shared/twin/forecast';
import { gmi, gmiFromReadings, projectGmi } from '../shared/twin/outlook';
import { buildTwin, type TwinModelData } from '../shared/twin/pipeline';
import { expectedEvents, learnRoutine } from '../shared/twin/routine';
import { assessRisk } from '../shared/twin/triage';
import { simulateEvening, verdict } from '../shared/twin/whatif';

const NOW = istTime(2026, 10, 13, 21, 40);
const day = istMidnight(NOW);
const visible = (h: History) => h.events.filter((e) => !e.hidden && e.t <= NOW);

/* ---------------- physiology ---------------- */

describe('physiological model', () => {
  const t0 = day + 12 * 60;
  const peakAfter = (events: TwinEvent[], p: PhysioParams = POPULATION) => {
    const r = run(p, events, t0, 600);
    return Math.max(...r.G);
  };

  it('settles to a steady level with no inputs', () => {
    const r = run(POPULATION, [], t0, 600);
    const tail = r.G.slice(400);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.5);
    // Basal secretion above the threshold pulls glucose a little below the hepatic set point.
    expect(Math.abs(r.G[599] - POPULATION.Gb)).toBeLessThan(8);
  });

  it('a meal raises glucose and more carbohydrate raises it more', () => {
    const base = POPULATION.Gb;
    const small = peakAfter([{ kind: 'meal', t: t0 + 30, carbs: 30 }]);
    const big = peakAfter([{ kind: 'meal', t: t0 + 30, carbs: 90 }]);
    expect(small).toBeGreaterThan(base + 10);
    expect(big).toBeGreaterThan(small + 30);
  });

  it('fast carbohydrate peaks higher than slow carbohydrate of the same amount', () => {
    expect(peakAfter([{ kind: 'meal', t: t0 + 30, carbs: 60, speed: 1.4 }])).toBeGreaterThan(peakAfter([{ kind: 'meal', t: t0 + 30, carbs: 60, speed: 0.8 }]));
  });

  it('a walk after the meal lowers the peak', () => {
    const meal: TwinEvent = { kind: 'meal', t: t0 + 30, carbs: 75, speed: 1.3 };
    expect(peakAfter([meal, { kind: 'walk', t: t0 + 60, duration: 30 }])).toBeLessThan(peakAfter([meal]) - 5);
  });

  it('metformin lowers the overnight level', () => {
    const night = (dose: boolean) => {
      const r = run(POPULATION, dose ? [{ kind: 'med', t: t0, drug: 'metformin', dose: 500 }] : [], t0, 600);
      return r.G[400];
    };
    expect(night(true)).toBeLessThan(night(false) - 10);
  });

  it('short sleep raises the next day after a meal', () => {
    const meal: TwinEvent = { kind: 'meal', t: t0 + 30, carbs: 70 };
    const after = (hours: number) => peakAfter([{ kind: 'sleep', t: t0 - 10 * 60, duration: hours * 60 }, meal], { ...POPULATION, sleepSens: 0.1 });
    expect(after(4.5)).toBeGreaterThan(after(8));
  });
});

/* ---------------- synthetic data ---------------- */

describe('synthetic patients', () => {
  it('is deterministic for a given seed', () => {
    const a = generateHistory(PERSONAS[0], NOW, { days: 3 });
    const b = generateHistory(PERSONAS[0], NOW, { days: 3 });
    expect(a.readings).toEqual(b.readings);
    expect(a.events.length).toBe(b.events.length);
  });

  it('produces 5-minute CGM readings over the history with occasional gaps', () => {
    const h = generateHistory(PERSONAS[0], NOW, { days: 7 });
    const steps = h.readings.slice(1).map((r, i) => r.t - h.readings[i].t);
    expect(steps.every((s) => s % 5 === 0)).toBe(true);
    expect(h.readings.length).toBeGreaterThan(7 * 288 * 0.9);
    expect(h.readings.length).toBeLessThan(7 * 288 + 300);
    expect(h.readings.every((r) => r.mgdl >= 40 && r.mgdl <= 400)).toBe(true);
  });

  it("hides some meals from the twin (they weren't logged)", () => {
    const h = generateHistory(PERSONAS[0], NOW);
    expect(h.events.some((e) => e.hidden)).toBe(true);
  });

  it('continues live from the checkpoint', () => {
    const h = generateHistory(PERSONAS[0], NOW, { days: 3 });
    const next = advanceTruth(h.params, h.events, h.checkpoint, NOW + 30, hashSeed('suresh'), h.sensorEnd);
    expect(next.readings.map((r) => r.t)).toEqual([NOW + 5, NOW + 10, NOW + 15, NOW + 20, NOW + 25, NOW + 30].filter((t) => next.readings.some((r) => r.t === t)));
    expect(next.checkpoint.t).toBe(NOW + 30);
  });

  it('stops readings when the sensor expires', () => {
    const fatima = PERSONAS.find((p) => p.id === 'fatima')!;
    const h = generateHistory(fatima, NOW, { days: 3 });
    const next = advanceTruth(h.params, h.events, h.checkpoint, NOW + 12 * 60, hashSeed('fatima'), h.sensorEnd);
    expect(h.sensorEnd).not.toBeNull();
    expect(next.readings.every((r) => r.t < h.sensorEnd!)).toBe(true);
  });
});

/* ---------------- the twin ---------------- */

describe('Suresh’s twin (fit → forecast → explain)', () => {
  let h: History;
  let twin: TwinModelData;

  beforeAll(() => {
    h = generateHistory(PERSONAS[0], NOW);
    twin = buildTwin({ events: visible(h), readings: h.readings, now: NOW, pronoun: 'he' });
  });

  it('fits his CGM closely', () => {
    expect(twin.fit.mard).toBeLessThan(7);
    expect(twin.fit.rmse).toBeLessThan(15);
  });

  it('recovers the physiology that matters tonight', () => {
    // Carb response and the walk's delayed effect drive tonight's low.
    expect(twin.params.carbGain / h.params.carbGain).toBeGreaterThan(0.8);
    expect(twin.params.carbGain / h.params.carbGain).toBeLessThan(1.25);
    expect(twin.params.walkLate / h.params.walkLate).toBeGreaterThan(0.6);
    expect(twin.params.walkLate / h.params.walkLate).toBeLessThan(1.5);
  });

  it('finds the large meals he did not log', () => {
    const from = NOW - 14 * 1440;
    const hidden = h.events.filter((e) => e.hidden && e.kind === 'meal' && e.t > from && (e.trueCarbs ?? 0) >= 45);
    const found = detectUnloggedMeals(twin.params, visible(h), h.readings, { from, to: NOW });
    const matched = hidden.filter((m) => found.some((f) => Math.abs(f.t - m.t) <= 45));
    expect(hidden.length).toBeGreaterThan(0);
    expect(matched.length / hidden.length).toBeGreaterThanOrEqual(0.75);
  });

  it('learns his routine', () => {
    const r = twin.routine;
    const dinner = r.meals.find((m) => m.slot === 'dinner')!;
    expect(minuteOfDayIST(day + dinner.at)).toBeGreaterThan(19 * 60 + 45);
    expect(r.doses.filter((d) => d.drug === 'metformin')).toHaveLength(2);
  });

  it('calibrates itself on past evenings', () => {
    expect(twin.calibration.nights).toBeGreaterThanOrEqual(8);
    expect(twin.calibration.mae[8]).toBeLessThan(12);
  });

  it('back-tests at any minute, not only on the 5-minute reading grid', () => {
    // The nightly refit runs whenever the live loop reaches 03:00 (e.g. 03:03), and "Build my twin" at any minute.
    const at = (t: number) => calibrate(twin.params, visible(h), h.readings.filter((r) => r.t <= t), t);
    const aligned = at(NOW);
    for (const off of [1, 3, 4]) {
      const c = at(NOW + off);
      expect(c.mae[1]).toBeGreaterThan(0);
      expect(c.mae[7]).toBeGreaterThan(0);
      expect(Math.abs(c.mae[7] - aligned.mae[7])).toBeLessThan(3);
    }
  });

  it('forecasts tonight’s low and the true night agrees', () => {
    const fc = forecast({ params: twin.params, logSd: twin.logSd, events: [...visible(h), ...twin.inferred], readings: h.readings, now: NOW, horizon: 360, routine: twin.routine, calibration: twin.calibration });
    const truth = advanceTruth(h.params, h.events, h.checkpoint, NOW + 360, hashSeed('suresh'), null).readings;
    expect(fc.pLow).toBeGreaterThan(0.4);
    expect(fc.lowest.v).toBeLessThan(75);
    expect(Math.min(...truth.map((r) => r.mgdl))).toBeLessThan(70);
    // Mean absolute error of the median over six hours.
    const errs = truth.map((r) => Math.abs((fc.median.find((m) => m.t === r.t)?.v ?? r.mgdl) - r.mgdl));
    expect(errs.reduce((a, b) => a + b, 0) / errs.length).toBeLessThan(12);
    const risk = assessRisk(fc);
    expect(risk.kind).toBe('low');
    expect(risk.level).not.toBe('Low');
  });

  it('explains the low with the walk as the biggest driver', () => {
    const drivers = attributeDrivers({ params: twin.params, events: visible(h), readings: h.readings, routine: twin.routine, now: NOW, direction: 'low', pronoun: 'he' });
    expect(drivers[0].kind).toBe('walk');
    expect(drivers[0].text).toBe('A 45-minute walk straight after dinner');
    expect(drivers.some((d) => d.kind === 'lighter-meal')).toBe(true);
    expect(drivers.every((d) => d.effect > 0)).toBe(true);
  });

  it('what-if responds to each lever in the right direction', () => {
    const base: { meal: { carbs: number; speed: number }; portion: number; walk: number; sleep: number; med: 'taken' | 'missed' } = { meal: { carbs: 60, speed: 1.1 }, portion: 1, walk: 0, sleep: 7, med: 'taken' };
    const sim = (patch: Partial<typeof base>) => simulateEvening(twin.params, twin.logSd, twin.routine, { ...base, ...patch }, { members: 10 });
    const b = sim({});
    expect(sim({ walk: 30 }).peak).toBeLessThan(b.peak);
    expect(sim({ portion: 1.5 }).peak).toBeGreaterThan(b.peak);
    expect(sim({ meal: { carbs: 60, speed: 0.8 } }).peak).toBeLessThan(b.peak);
    expect(sim({ med: 'missed' }).overnightLow).toBeGreaterThan(b.overnightLow);
    expect(verdict({ peak: 170, aboveMin: 0 })).toBe('in-range');
    expect(verdict({ peak: 190, aboveMin: 20 })).toBe('brief');
    expect(verdict({ peak: 230, aboveMin: 90 })).toBe('long');
  });

  it('estimates HbA1c from CGM and projects routines', () => {
    expect(gmi(154)).toBeCloseTo(6.99, 2);
    const g = gmiFromReadings(h.readings, NOW)!;
    expect(g.value).toBeGreaterThan(6);
    expect(g.value).toBeLessThan(8.5);
    expect(projectGmi(twin.params, twin.routine, 'stop')).toBeGreaterThanOrEqual(projectGmi(twin.params, twin.routine, 'keep'));
  });
});

describe('other patients’ twins', () => {
  it('flags Arjun’s fever-driven high', () => {
    const p = PERSONAS.find((x) => x.id === 'arjun')!;
    const h = generateHistory(p, NOW);
    const t = buildTwin({ events: visible(h), readings: h.readings, now: NOW });
    const fc = forecast({ params: t.params, logSd: t.logSd, events: [...visible(h), ...t.inferred], readings: h.readings, now: NOW, horizon: 360, routine: t.routine, calibration: t.calibration });
    const risk = assessRisk(fc);
    expect(risk.kind).toBe('high');
    const drivers = attributeDrivers({ params: t.params, events: visible(h), readings: h.readings, routine: t.routine, now: NOW, direction: 'high' });
    expect(drivers[0].kind).toBe('illness');
  });

  it('notices Lakshmi’s missed evening doses', () => {
    const p = PERSONAS.find((x) => x.id === 'lakshmi')!;
    const h = generateHistory(p, NOW);
    const t = buildTwin({ events: visible(h), readings: h.readings, now: NOW });
    const drivers = attributeDrivers({ params: t.params, events: visible(h), readings: h.readings, routine: t.routine, now: NOW, direction: 'high', pronoun: 'she' });
    expect(drivers.some((d) => d.kind === 'dose-missed' && /No evening metformin logged for/.test(d.text))).toBe(true);
  });

  it('keeps Imran stable', () => {
    const p = PERSONAS.find((x) => x.id === 'imran')!;
    const h = generateHistory(p, NOW);
    const t = buildTwin({ events: visible(h), readings: h.readings, now: NOW });
    const fc = forecast({ params: t.params, logSd: t.logSd, events: [...visible(h), ...t.inferred], readings: h.readings, now: NOW, horizon: 360, routine: t.routine, calibration: t.calibration });
    expect(assessRisk(fc).kind).toBe('stable');
  });
});

describe('routine', () => {
  it('expects the usual breakfast and morning dose when they have not been logged', () => {
    const routine = learnRoutine(
      Array.from({ length: 10 }, (_, d) => [
        { kind: 'meal' as const, t: day - (d + 1) * 1440 + 7 * 60 + 45, carbs: 55, speed: 1.2 },
        { kind: 'med' as const, t: day - (d + 1) * 1440 + 8 * 60, drug: 'metformin' as const, dose: 500 },
      ]).flat(),
      day - 10 * 1440,
      day,
    );
    const exp = expectedEvents(routine, [], NOW, NOW + 12 * 60);
    expect(exp.map((e) => [e.kind, clockIST(e.t)])).toEqual([
      ['meal', '07:45'],
      ['med', '08:00'],
    ]);
  });
});

describe('time helpers', () => {
  it('formats IST clock times and durations', () => {
    expect(clockIST(NOW)).toBe('21:40');
    expect(clockIST(NOW + 330)).toBe('03:10');
    expect(formatDuration(150)).toBe('2 h 30 min');
    expect(formatDuration(0)).toBe('0 min');
    expect(minuteOfDayIST(NOW)).toBe(21 * 60 + 40);
  });
});
