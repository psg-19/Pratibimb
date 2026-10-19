/**
 * A synthetic sensor for a newly signed-up patient: when they connect the demo CGM, we create
 * a plausible "true" physiology (seeded from their id) and two weeks of history, so the twin
 * has something to learn from. Real devices replace this path.
 */
import type { Drug } from '../physio/events';
import { POPULATION } from '../physio/model';
import { hashSeed, rng } from '../rng';
import { PERSONAS, type Persona } from './personas';

export function parseMeds(medsLong: string): { drug: Drug; dose: number; times: ('morning' | 'evening')[] }[] {
  const out: { drug: Drug; dose: number; times: ('morning' | 'evening')[] }[] = [];
  const lower = medsLong.toLowerCase();
  for (const drug of ['metformin', 'glimepiride', 'sitagliptin'] as const) {
    const m = new RegExp(`${drug}\\s*(\\d+(?:\\.\\d+)?)\\s*(mg|g)?`).exec(lower);
    if (!lower.includes(drug)) continue;
    let dose = m ? Number(m[1]) * (m[2] === 'g' ? 1000 : 1) : drug === 'metformin' ? 500 : drug === 'glimepiride' ? 1 : 100;
    if (drug === 'metformin' && dose < 50) dose *= 1000;
    const twice = /twice|bd|b\.d\.|2x|two times/.test(lower) && drug === 'metformin';
    out.push({ drug, dose, times: twice ? ['morning', 'evening'] : drug === 'glimepiride' ? ['evening'] : ['morning'] });
  }
  return out.length ? out : [{ drug: 'metformin', dose: 500, times: ['morning', 'evening'] }];
}

export function personaForNewPatient(p: { id: string; name: string; medsLong: string }): Persona {
  const r = rng(hashSeed(`new:${p.id}`));
  const base = PERSONAS[0];
  const meds = parseMeds(p.medsLong);
  return {
    ...base,
    id: p.id,
    name: p.name,
    email: '',
    scenario: [],
    skips: [],
    starts: [],
    labs: [],
    sensorExpires: undefined,
    truth: {
      Gb: POPULATION.Gb * Math.exp(0.1 * r.normal()),
      SI: POPULATION.SI * Math.exp(0.3 * r.normal()),
      carbGain: POPULATION.carbGain * Math.exp(0.15 * r.normal()),
      walkLate: POPULATION.walkLate * Math.exp(0.3 * r.normal()),
    },
    routine: {
      ...base.routine,
      walks: [{ at: [r.pick([7, 18, 20]), 30] as const, prob: r.range(0.3, 0.7), minutes: [15, 35] as const }],
      meds: meds.flatMap((m) =>
        m.times.map((when) => ({ at: (when === 'morning' ? [8, 0] : m.drug === 'glimepiride' ? [19, 30] : [21, 0]) as [number, number], drug: m.drug, dose: m.dose, adherence: 0.95 })),
      ),
    },
  };
}
