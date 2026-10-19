/**
 * Synthetic patients. Each has "true" physiology (hidden from the twin), a daily routine with
 * variability, and a scenario for the demo evening. All of it is invented for the prototype.
 */
import type { Drug } from '../physio/events';
import type { PhysioParams } from '../physio/model';

export type Lang = 'en' | 'hi' | 'kn';
export type SourceId = 'cgm' | 'watch' | 'abha' | 'meals' | 'bp';

type HM = readonly [number, number];

export interface MealSlot {
  at: HM;
  /** ± minutes of day-to-day jitter. */
  jitter: number;
  carbs: readonly [number, number];
  speed: number;
  labels: readonly string[];
}

export interface Routine {
  sleepAt: HM;
  sleepHours: readonly [number, number];
  breakfast: MealSlot;
  lunch: MealSlot;
  tea: MealSlot;
  dinner: MealSlot;
  walks: readonly { at: HM; prob: number; minutes: readonly [number, number] }[];
  meds: readonly { at: HM; drug: Drug; dose: number; adherence: number }[];
  /** Probability a meal is logged at all (unlogged meals stay hidden from the twin). */
  logProb: number;
  /** SD of the log-ratio between logged and true carbs. */
  carbError: number;
  restingHr: number;
  baseSteps: number;
}

export interface Lab {
  /** ISO date. */
  date: string;
  test: 'HbA1c' | 'Fasting glucose' | 'LDL cholesterol' | 'Creatinine';
  value: number;
  unit: string;
  source: string;
}

/** Events for the demo day, as offsets from IST midnight of that day. */
export interface ScenarioEvent {
  kind: 'meal' | 'walk' | 'med' | 'sleep' | 'illness';
  at: HM;
  /** Offset in days from the demo day (−1 = yesterday). */
  day?: number;
  carbs?: number;
  trueCarbs?: number;
  speed?: number;
  label?: string;
  source?: 'logged' | 'photo' | 'voice' | 'device';
  note?: string;
  duration?: number;
  steps?: number;
  drug?: Drug;
  dose?: number;
  severity?: number;
  /** Events the patient did not log: the truth simulation uses them, the twin never sees them. */
  hidden?: boolean;
}

export interface Persona {
  id: string;
  name: string;
  initials: string;
  age: number;
  yearsT2D: number;
  city: string;
  language: Lang;
  medsShort: string;
  medsLong: string;
  avatar: 'g' | 'pk' | 'b' | 'o' | 'r' | 'y';
  email: string;
  truth: Partial<PhysioParams>;
  routine: Routine;
  /** Replaces the routine for these days (0 = demo day). */
  scenario: ScenarioEvent[];
  /** Routine slots skipped on given days, e.g. missed doses: `${day}:${slot}`. */
  skips?: string[];
  /** Medicines that start partway through history: drug and first day offset. */
  starts?: { drug: Drug; dose: number; at: HM; fromDay: number }[];
  labs: Lab[];
  sources: Record<SourceId, boolean>;
  /** Sensor end, as [day offset, h, m]. */
  sensorExpires?: readonly [number, number, number];
  abhaSuffix: string;
}

const routineBase: Routine = {
  sleepAt: [22, 45],
  sleepHours: [6.4, 7.8],
  breakfast: { at: [7, 45], jitter: 20, carbs: [45, 60], speed: 1.25, labels: ['Idli, sambar', 'Plain dosa, chutney', 'Upma', 'Poha'] },
  lunch: { at: [13, 10], jitter: 25, carbs: [70, 90], speed: 1.3, labels: ['Rice, sambar, poriyal', 'Rice, rasam, curd', 'Bisi bele bath'] },
  tea: { at: [16, 45], jitter: 20, carbs: [15, 25], speed: 1.45, labels: ['Tea with sugar, biscuits', 'Coffee with sugar'] },
  dinner: { at: [20, 15], jitter: 20, carbs: [80, 95], speed: 1.2, labels: ['Rice, dal, sabzi', '3 chapati, dal, sabzi', 'Ragi mudde, saaru'] },
  walks: [{ at: [18, 30], prob: 0.45, minutes: [10, 20] }],
  meds: [
    { at: [8, 0], drug: 'metformin', dose: 500, adherence: 0.97 },
    { at: [21, 0], drug: 'metformin', dose: 500, adherence: 0.93 },
  ],
  logProb: 0.9,
  carbError: 0.18,
  restingHr: 72,
  baseSteps: 2000,
};

export const PERSONAS: readonly Persona[] = [
  {
    id: 'suresh',
    name: 'Suresh R.',
    initials: 'SR',
    age: 54,
    yearsT2D: 9,
    city: 'Bengaluru',
    language: 'kn',
    medsShort: 'Metformin 500 mg BD',
    medsLong: 'Metformin 500 mg twice daily',
    avatar: 'b',
    email: 'suresh@pratibimb.demo',
    truth: { Gb: 134, metEffect: 28, walkAcute: 0.6, walkLate: 1.0, walkTau: 380, SG: 0.009, slowFrac: 0.35, tmaxSlow: 240 },
    routine: { ...routineBase, walks: [{ at: [20, 50], prob: 0.4, minutes: [15, 40] }] },
    scenario: [
      { kind: 'sleep', day: -1, at: [0, 20], duration: 370, source: 'device' },
      { kind: 'meal', at: [7, 50], carbs: 52, trueCarbs: 55, speed: 1.25, label: '3 idli, sambar', source: 'photo' },
      { kind: 'med', at: [8, 5], drug: 'metformin', dose: 500, source: 'logged' },
      { kind: 'meal', at: [12, 30], carbs: 52, trueCarbs: 54, speed: 1.3, label: 'Rice, sambar, poriyal (small plate)', source: 'photo' },
      { kind: 'meal', at: [16, 50], carbs: 22, trueCarbs: 24, speed: 1.45, label: 'Tea with sugar, 2 biscuits', source: 'voice', note: 'Voice note, Kannada' },
      { kind: 'meal', at: [20, 15], carbs: 50, trueCarbs: 52, speed: 1.2, label: '2 chapati, dal, bhindi sabzi', source: 'photo' },
      { kind: 'walk', at: [20, 50], duration: 45, steps: 4100, source: 'device' },
      { kind: 'med', at: [21, 0], drug: 'metformin', dose: 500, source: 'logged' },
    ],
    labs: [
      { date: '2026-01-14', test: 'HbA1c', value: 8.4, unit: '%', source: 'Synthetic lab (ABHA)' },
      { date: '2026-04-11', test: 'HbA1c', value: 8.1, unit: '%', source: 'Synthetic lab (ABHA)' },
      { date: '2026-07-09', test: 'HbA1c', value: 7.8, unit: '%', source: 'Synthetic lab (ABHA)' },
      { date: '2026-07-09', test: 'Fasting glucose', value: 142, unit: 'mg/dL', source: 'Synthetic lab (ABHA)' },
    ],
    sources: { cgm: true, watch: true, abha: true, meals: true, bp: false },
    abhaSuffix: '4821',
  },
  {
    id: 'arjun',
    name: 'Arjun P.',
    initials: 'AP',
    age: 39,
    yearsT2D: 3,
    city: 'Bengaluru',
    language: 'en',
    medsShort: 'Metformin + sitagliptin',
    medsLong: 'Metformin 500 mg twice daily, sitagliptin 100 mg daily',
    avatar: 'o',
    email: 'arjun@pratibimb.demo',
    truth: { Gb: 158, SI: 2.4e-4, carbGain: 4.6, gamma: 0.004, walkLate: 0.5 },
    routine: {
      ...routineBase,
      sleepAt: [23, 30],
      sleepHours: [6.0, 7.2],
      walks: [{ at: [7, 0], prob: 0.35, minutes: [20, 30] }],
      meds: [...routineBase.meds, { at: [8, 0], drug: 'sitagliptin', dose: 100, adherence: 0.95 }],
      restingHr: 76,
      baseSteps: 3500,
    },
    scenario: [
      { kind: 'sleep', day: -1, at: [2, 0], duration: 240, source: 'device' },
      { kind: 'meal', at: [9, 0], carbs: 55, trueCarbs: 58, speed: 1.25, label: 'Masala dosa', source: 'photo' },
      { kind: 'med', at: [9, 5], drug: 'metformin', dose: 500, source: 'logged' },
      { kind: 'meal', at: [13, 30], carbs: 75, trueCarbs: 80, speed: 1.3, label: 'Rice, rasam, curd', source: 'logged' },
      { kind: 'illness', at: [18, 0], duration: 2160, severity: 0.9, label: 'Fever 38.4 °C', source: 'logged' },
      { kind: 'meal', at: [20, 0], carbs: 40, trueCarbs: 45, speed: 1.2, label: 'Rice kanji, pickle', source: 'logged' },
      { kind: 'med', at: [21, 0], drug: 'metformin', dose: 500, source: 'logged' },
    ],
    labs: [
      { date: '2026-08-20', test: 'HbA1c', value: 8.6, unit: '%', source: 'Synthetic lab (ABHA)' },
    ],
    sources: { cgm: true, watch: true, abha: true, meals: true, bp: false },
    abhaSuffix: '1907',
  },
  {
    id: 'lakshmi',
    name: 'Lakshmi N.',
    initials: 'LN',
    age: 61,
    yearsT2D: 14,
    city: 'Mysuru',
    language: 'kn',
    medsShort: 'Metformin 1 g BD',
    medsLong: 'Metformin 1 g twice daily',
    avatar: 'pk',
    email: 'lakshmi@pratibimb.demo',
    truth: { Gb: 140, SI: 2.8e-4, metEffect: 20, walkLate: 0.4 },
    routine: {
      ...routineBase,
      sleepAt: [22, 15],
      walks: [{ at: [6, 30], prob: 0.4, minutes: [15, 25] }],
      meds: [
        { at: [8, 0], drug: 'metformin', dose: 1000, adherence: 0.97 },
        { at: [21, 0], drug: 'metformin', dose: 1000, adherence: 0.9 },
      ],
      restingHr: 78,
      baseSteps: 2500,
    },
    skips: ['-1:med-evening', '0:med-evening'],
    scenario: [
      { kind: 'meal', at: [8, 0], carbs: 50, trueCarbs: 52, speed: 1.25, label: 'Idli, chutney', source: 'logged' },
      { kind: 'med', at: [8, 10], drug: 'metformin', dose: 1000, source: 'logged' },
      { kind: 'meal', at: [13, 0], carbs: 80, trueCarbs: 85, speed: 1.3, label: 'Rice, sambar, palya', source: 'logged' },
      { kind: 'meal', at: [19, 30], carbs: 40, trueCarbs: 45, speed: 1.5, label: 'Festival sweets (Mysore pak, payasam)', source: 'voice', note: 'Voice note, Kannada' },
      { kind: 'meal', at: [20, 30], carbs: 65, trueCarbs: 70, speed: 1.2, label: 'Chapati, dal, sabzi', source: 'logged' },
    ],
    labs: [{ date: '2026-06-02', test: 'HbA1c', value: 8.0, unit: '%', source: 'Synthetic lab (ABHA)' }],
    sources: { cgm: true, watch: false, abha: true, meals: true, bp: true },
    abhaSuffix: '3360',
  },
  {
    id: 'meera',
    name: 'Meera K.',
    initials: 'MK',
    age: 58,
    yearsT2D: 6,
    city: 'Bengaluru',
    language: 'hi',
    medsShort: 'Metformin + glimepiride 1 mg',
    medsLong: 'Metformin 500 mg twice daily, glimepiride 1 mg with dinner (started 3 days ago)',
    avatar: 'g',
    email: 'meera@pratibimb.demo',
    truth: { Gb: 122, SI: 3.6e-4, suEffect: 2.4, walkLate: 0.6 },
    routine: { ...routineBase, dinner: { ...routineBase.dinner, at: [20, 0] }, restingHr: 70, baseSteps: 4000 },
    starts: [{ drug: 'glimepiride', dose: 1, at: [19, 5], fromDay: -3 }],
    scenario: [
      { kind: 'meal', at: [7, 40], carbs: 45, trueCarbs: 46, speed: 1.2, label: 'Poha', source: 'logged' },
      { kind: 'med', at: [8, 0], drug: 'metformin', dose: 500, source: 'logged' },
      { kind: 'meal', at: [13, 0], carbs: 65, trueCarbs: 68, speed: 1.25, label: 'Rice, dal, sabzi', source: 'logged' },
      { kind: 'meal', at: [16, 40], carbs: 10, trueCarbs: 10, speed: 1.5, label: 'Tea with sugar', source: 'logged' },
      { kind: 'meal', at: [19, 0], carbs: 55, trueCarbs: 55, speed: 1.1, label: '2 chapati, dal, sabzi', source: 'logged' },
      { kind: 'med', at: [19, 5], drug: 'glimepiride', dose: 1, source: 'logged' },
      { kind: 'med', at: [21, 0], drug: 'metformin', dose: 500, source: 'logged' },
    ],
    labs: [{ date: '2026-09-30', test: 'HbA1c', value: 7.6, unit: '%', source: 'Synthetic lab (ABHA)' }],
    sources: { cgm: true, watch: true, abha: true, meals: true, bp: false },
    abhaSuffix: '5512',
  },
  {
    id: 'fatima',
    name: 'Fatima B.',
    initials: 'FB',
    age: 66,
    yearsT2D: 11,
    city: 'Bengaluru',
    language: 'hi',
    medsShort: 'Metformin 500 mg BD',
    medsLong: 'Metformin 500 mg twice daily',
    avatar: 'y',
    email: 'fatima@pratibimb.demo',
    truth: { Gb: 118, SI: 4.0e-4, carbGain: 3.6, walkLate: 0.35 },
    routine: {
      ...routineBase,
      lunch: { ...routineBase.lunch, carbs: [55, 70] },
      dinner: { ...routineBase.dinner, at: [19, 45], carbs: [50, 65] },
      walks: [{ at: [17, 30], prob: 0.6, minutes: [20, 30] }],
      restingHr: 74,
      baseSteps: 3000,
    },
    scenario: [],
    labs: [{ date: '2026-08-05', test: 'HbA1c', value: 6.9, unit: '%', source: 'Synthetic lab (ABHA)' }],
    sources: { cgm: true, watch: true, abha: true, meals: true, bp: true },
    sensorExpires: [1, 3, 40],
    abhaSuffix: '7745',
  },
  {
    id: 'imran',
    name: 'Imran S.',
    initials: 'IS',
    age: 47,
    yearsT2D: 2,
    city: 'Bengaluru',
    language: 'en',
    medsShort: 'Metformin 500 mg OD',
    medsLong: 'Metformin 500 mg once daily',
    avatar: 'r',
    email: 'imran@pratibimb.demo',
    truth: { Gb: 112, SI: 4.6e-4, carbGain: 3.4, walkLate: 0.4 },
    routine: {
      ...routineBase,
      lunch: { ...routineBase.lunch, carbs: [55, 70], speed: 1.1 },
      dinner: { ...routineBase.dinner, carbs: [55, 70], speed: 1.0 },
      walks: [{ at: [6, 45], prob: 0.85, minutes: [25, 35] }],
      meds: [{ at: [8, 0], drug: 'metformin', dose: 500, adherence: 0.98 }],
      restingHr: 66,
      baseSteps: 5500,
    },
    scenario: [],
    labs: [{ date: '2026-09-12', test: 'HbA1c', value: 6.6, unit: '%', source: 'Synthetic lab (ABHA)' }],
    sources: { cgm: true, watch: true, abha: true, meals: true, bp: false },
    abhaSuffix: '2288',
  },
];

export const personaById = (id: string) => PERSONAS.find((p) => p.id === id);
