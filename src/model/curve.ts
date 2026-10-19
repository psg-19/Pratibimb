import type { BandPoint, Keyframes, Series } from './types';

/**
 * Cosine interpolation between key points (spec §5):
 * f = (t − a.t)/(b.t − a.t), s = (1 − cos(π·f))/2, v = a.v + (b.v − a.v)·s.
 * Outside the keyframe range the value is held at the nearest end.
 */
export function interpolate(keys: Keyframes, t: number): number {
  if (keys.length === 0) throw new Error('interpolate: no keyframes');
  const [t0, v0] = keys[0];
  const [tn, vn] = keys[keys.length - 1];
  if (t <= t0) return v0;
  if (t >= tn) return vn;
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, va] = keys[i];
    const [tb, vb] = keys[i + 1];
    if (t >= ta && t <= tb && tb > ta) {
      const f = (t - ta) / (tb - ta);
      const s = (1 - Math.cos(Math.PI * f)) / 2;
      return va + (vb - va) * s;
    }
  }
  return vn;
}

/** Sample the curve from t0 to t1 (inclusive) every `step` minutes. */
export function sample(keys: Keyframes, t0: number, t1: number, step = 5): Series {
  const out: Series = [];
  for (let t = t0; t <= t1 + 1e-9; t += step) out.push({ t, v: interpolate(keys, t) });
  return out;
}

/** Sample a band of half-width `halfWidth(t)` around the curve. */
export function sampleBand(
  keys: Keyframes,
  t0: number,
  t1: number,
  step: number,
  halfWidth: (t: number) => number,
): BandPoint[] {
  return sample(keys, t0, t1, step).map(({ t, v }) => ({ t, lo: v - halfWidth(t), hi: v + halfWidth(t) }));
}

/** Widening uncertainty: base + slope·(t − from). */
export const widening =
  (base: number, slope: number, from: number) =>
  (t: number): number =>
    base + slope * (t - from);

/** First sampled time at or after `from` where the curve is at or below `threshold`, or null. */
export function firstAtOrBelow(keys: Keyframes, threshold: number, from: number, to: number, step = 5): number | null {
  for (let t = from; t <= to + 1e-9; t += step) if (interpolate(keys, t) <= threshold + 1e-9) return t;
  return null;
}
