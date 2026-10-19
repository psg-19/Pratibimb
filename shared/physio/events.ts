/** Events the twin learns from and plays forward. Times are epoch minutes. */

export type EventSource = 'routine' | 'logged' | 'photo' | 'voice' | 'device' | 'inferred' | 'planned' | 'suggested';

export interface MealEvent {
  kind: 'meal';
  t: number;
  /** Carbohydrate, g. */
  carbs: number;
  /** Absorption speed relative to a medium meal (rice ≈ 1.3, millet ≈ 0.85). */
  speed?: number;
  label?: string;
  source?: EventSource;
}

export interface WalkEvent {
  kind: 'walk';
  t: number;
  /** Minutes. */
  duration: number;
  /** 1 = brisk walk. */
  intensity?: number;
  steps?: number;
  source?: EventSource;
}

export type Drug = 'metformin' | 'glimepiride' | 'sitagliptin';

export interface MedEvent {
  kind: 'med';
  t: number;
  drug: Drug;
  /** mg. */
  dose: number;
  source?: EventSource;
}

export interface SleepEvent {
  kind: 'sleep';
  /** Sleep onset. */
  t: number;
  /** Minutes asleep. */
  duration: number;
  source?: EventSource;
}

export interface IllnessEvent {
  kind: 'illness';
  t: number;
  duration: number;
  /** 0–1. */
  severity: number;
  label?: string;
  source?: EventSource;
}

export type TwinEvent = MealEvent | WalkEvent | MedEvent | SleepEvent | IllnessEvent;

export const isMeal = (e: TwinEvent): e is MealEvent => e.kind === 'meal';
export const isWalk = (e: TwinEvent): e is WalkEvent => e.kind === 'walk';
export const isMed = (e: TwinEvent): e is MedEvent => e.kind === 'med';
export const isSleep = (e: TwinEvent): e is SleepEvent => e.kind === 'sleep';
