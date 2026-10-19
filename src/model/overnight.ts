import { OVERNIGHT } from '../data/overnight';
import { firstAtOrBelow, interpolate, sample, sampleBand, widening } from './curve';
import type { BandPoint, Keyframes, Series } from './types';

export type CareMode = 'reactive' | 'proactive';
export const LOW_THRESHOLD = 70;

export interface OvernightView {
  mode: CareMode;
  measured: Series;
  forecast: Series;
  band: BandPoint[];
  snack: Series;
  /** Measured curve clamped at 70, for shading the part below 70 (reactive only). */
  belowLow: Series;
  /** When the warning fires and the glucose at that moment. */
  marker: { t: number; v: number };
  /** Minutes of warning before glucose reaches 70. */
  leadMinutes: number;
}

/**
 * "One night, two kinds of care". Reactive: the CGM alarm sounds when glucose is already at 70.
 * Proactive: the twin forecasts the low from 00:10 and offers a snack scenario.
 */
export function overnightView(mode: CareMode, data = OVERNIGHT): OvernightView {
  const { keys, duration } = data;
  const pro = mode === 'proactive';
  const alertT = pro ? data.proactiveAlertT : data.reactiveAlarmT;
  const lowOnset = firstAtOrBelow(keys, LOW_THRESHOLD, 0, duration) ?? duration;

  const measured = sample(keys, 0, pro ? alertT : duration);
  let forecast: Series = [];
  let band: BandPoint[] = [];
  let snack: Series = [];
  let belowLow: Series = [];

  if (pro) {
    forecast = sample(keys, alertT, duration);
    band = sampleBand(keys, alertT, duration, 10, widening(data.band.base, data.band.slope, alertT));
    const snackKeys: Keyframes = [[alertT, interpolate(keys, alertT)], ...data.snackTail];
    snack = sample(snackKeys, alertT, duration);
  } else {
    belowLow = sample(keys, 0, duration).map(({ t, v }) => ({ t, v: Math.min(v, LOW_THRESHOLD) }));
  }

  return {
    mode,
    measured,
    forecast,
    band,
    snack,
    belowLow,
    marker: { t: alertT, v: interpolate(keys, alertT) },
    leadMinutes: Math.max(0, lowOnset - alertT),
  };
}
