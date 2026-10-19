/** A key point of a synthetic curve: [minutes since series start, mg/dL]. */
export type Keyframe = readonly [t: number, v: number];
export type Keyframes = readonly Keyframe[];

export interface Point {
  t: number;
  v: number;
}
export type Series = Point[];

/** Uncertainty band around a forecast at time t. */
export interface BandPoint {
  t: number;
  lo: number;
  hi: number;
}

/** Fixed hue per concept: g green, pk pink, b blue, o orange, r red, y yellow. */
export type Hue = 'g' | 'pk' | 'b' | 'o' | 'r' | 'y';

export type SourceId = 'cgm' | 'watch' | 'abha' | 'meals' | 'bp';
export type SourceFlags = Record<SourceId, boolean>;

/** A device or record feed the twin learns from. Synthetic today; CGM / Health Connect / ABDM later. */
export interface DataSource {
  readonly id: SourceId;
  /** Resolves once the first sync has completed. Rejects with an AbortError if `signal` aborts. */
  connect(signal?: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
}

export type Horizon = 120 | 360 | 720;
export type ForecastScenario = 'baseline' | 'snack';

export interface ForecastReadout {
  /** Lowest forecast value inside the horizon, mg/dL (unrounded). */
  min: number;
  /** Time of that low, minutes since series start. */
  minT: number;
  /** Share of forecast samples within 70–180 mg/dL, 0–100 (rounded). */
  inRangePct: number;
}

export interface Forecast {
  now: number;
  end: number;
  measured: Series;
  /** Baseline twin forecast, now → end. */
  forecast: Series;
  band: BandPoint[];
  /** "What if" line drawn on top of the baseline (e.g. the bedtime snack). */
  scenario: Series | null;
  /** Readout for whichever line is in effect (scenario if set, else baseline). */
  readout: ForecastReadout;
  /** Predicted low-risk window, when it falls inside the horizon and no scenario removes it. */
  riskWindow: { from: number; to: number } | null;
}

export type MealId = 'rice' | 'chapati' | 'millet';
export type MedStatus = 'taken' | 'missed';

export interface WhatIfInput {
  meal: MealId;
  /** Portion multiplier, 0.5–1.5. */
  portion: number;
  /** Walk after dinner, minutes (0–45). */
  walk: number;
  /** Sleep last night, hours (4–9). */
  sleep: number;
  med: MedStatus;
}

export interface WhatIfResult {
  /** Glucose for each minute 0…180 after dinner. */
  pts: number[];
  peak: number;
  peakT: number;
  /** Minutes with glucose above the 180 mg/dL target. */
  aboveMin: number;
}

/** The patient's digital twin: plays the next hours forward and runs what-ifs. */
export interface TwinModel {
  readonly patientId: string;
  forecast(horizon: Horizon, scenario: ForecastScenario): Forecast;
  simulateMeal(input: WhatIfInput): WhatIfResult;
}
