/**
 * "What the twin has learned": plain facts read off the fitted physiology by running
 * controlled experiments on the twin (same person, one thing changed).
 */
import { buildInputs, fillMeals, simulate, steadyState, setPoint, type PhysioParams } from '../physio/model';
import type { LearnedRoutine } from './routine';
import { eveningEvents, SCENARIO_DAY, type EveningPlan } from './scenario';

export interface Insight {
  id: 'rice-peak' | 'walk-peak' | 'sleep' | 'low-dinner';
  text: string;
  value: string;
  /** Show in the risk colour. */
  risk?: boolean;
}

function sensor(G: Float64Array) {
  const out = new Float64Array(G.length);
  let gi = G[0];
  for (let i = 0; i < G.length; i++) {
    gi += (G[i] - gi) / 8;
    out[i] = gi;
  }
  return out;
}

function runEvening(p: PhysioParams, r: LearnedRoutine, plan: EveningPlan) {
  const { events, dinner } = eveningEvents(r, plan, SCENARIO_DAY);
  const prev = eveningEvents(r, { ...plan, walk: 0, eveningDose: true, sleep: 7 }, SCENARIO_DAY - 1440).events.filter((e) => e.t < SCENARIO_DAY);
  const t0 = SCENARIO_DAY - 1440;
  const len = dinner + 660 - t0;
  const inp = buildInputs([...prev, ...events], t0, len);
  fillMeals(inp, p.tmax, p.tmaxSlow, p.slowFrac);
  const G = sensor(simulate(p, inp, steadyState(p, setPoint(p, inp, 0))).G);
  return { G, off: dinner - t0, wakeOff: SCENARIO_DAY + 390 - t0, dinnerOff: dinner - t0 };
}

const round5 = (x: number) => Math.round(x / 5) * 5;

export function learnedInsights(p: PhysioParams, r: LearnedRoutine, pronoun: 'he' | 'she' | 'they' = 'they'): Insight[] {
  const out: Insight[] = [];
  const usualDinner = r.meals.find((m) => m.slot === 'dinner') ?? { carbs: 80, speed: 1.2 };
  const takesEvening = r.doses.some((d) => d.slot === 'evening');
  const base: EveningPlan = { carbs: usualDinner.carbs, speed: usualDinner.speed, walk: 0, sleep: 7, eveningDose: takesEvening };

  // Rice-heavy meal: time to peak.
  {
    const e = runEvening(p, r, { ...base, carbs: 75, speed: 1.35 });
    let peakT = 0;
    for (let t = 0; t <= 180; t++) if (e.G[e.off + t] > e.G[e.off + peakT]) peakT = t;
    out.push({ id: 'rice-peak', text: 'Rice-heavy meals peak after', value: `${round5(peakT)} min` });
  }
  // 20-minute walk after dinner.
  {
    const a = runEvening(p, r, base);
    const b = runEvening(p, r, { ...base, walk: 20 });
    const peak = (x: typeof a) => Math.max(...x.G.subarray(x.off, x.off + 180));
    const d = peak(a) - peak(b);
    out.push({ id: 'walk-peak', text: 'A 20-min walk after dinner lowers the peak by', value: `≈ ${Math.max(5, round5(d))} mg/dL` });
  }
  // Short sleep: next-day daytime mean.
  {
    const day = (h: number) => {
      const e = runEvening(p, r, { ...base, sleep: h });
      const seg = e.G.subarray(e.wakeOff, e.dinnerOff);
      return seg.reduce((s, v) => s + v, 0) / seg.length;
    };
    const pct = Math.round((100 * (day(5.5) - day(7.5))) / day(7.5));
    out.push({
      id: 'sleep',
      text: 'After under 6 h of sleep, next-day glucose runs',
      value: pct >= 2 ? `≈ ${pct}% higher` : 'about the same',
    });
  }
  // Dinner size below which an overnight low becomes likely after a long evening walk.
  {
    const walk = 45;
    let threshold = 0;
    for (let c = 125; c >= 10; c -= 5) {
      const e = runEvening(p, r, { ...base, carbs: c, walk });
      const night = e.G.subarray(e.off + 180, e.off + 660);
      if (Math.min(...night) < 70) {
        threshold = c;
        break;
      }
    }
    if (threshold >= 125) {
      out.push({ id: 'low-dinner', text: 'After a long evening walk, an overnight low is possible even after', value: 'a full dinner', risk: true });
    } else if (threshold > 0) {
      out.push({ id: 'low-dinner', text: 'Overnight lows are likeliest when dinner is under', value: `${threshold} g carbs`, risk: true });
    } else {
      out.push({ id: 'low-dinner', text: `Overnight lows after a ${walk}-min evening walk`, value: 'not expected' });
    }
  }
  void pronoun;
  return out;
}
