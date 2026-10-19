import { firstAtOrBelow, interpolate, sample, sampleBand, widening } from './curve';
import type { Keyframes } from './types';

const K: Keyframes = [
  [0, 176],
  [40, 190],
  [100, 152],
];

describe('interpolate (cosine)', () => {
  it('passes exactly through every key point', () => {
    for (const [t, v] of K) expect(interpolate(K, t)).toBe(v);
  });

  it('is halfway between keys at the segment midpoint', () => {
    expect(interpolate(K, 20)).toBeCloseTo(183, 10);
  });

  it('follows s = (1 − cos(π·f)) / 2 inside a segment', () => {
    // f = 0.25 → s = (1 − cos(π/4)) / 2
    const s = (1 - Math.cos(Math.PI / 4)) / 2;
    expect(interpolate(K, 10)).toBeCloseTo(176 + 14 * s, 10);
    expect(interpolate(K, 10)).toBeCloseTo(178.0503, 4);
  });

  it('eases in and out: flat at the keys, steepest mid-segment', () => {
    const slope = (t: number) => interpolate(K, t + 0.01) - interpolate(K, t);
    expect(Math.abs(slope(0.01))).toBeLessThan(Math.abs(slope(20)));
    expect(Math.abs(slope(39.98))).toBeLessThan(Math.abs(slope(20)));
  });

  it('never overshoots the neighbouring keys', () => {
    for (let t = 40; t <= 100; t += 0.5) {
      const v = interpolate(K, t);
      expect(v).toBeLessThanOrEqual(190);
      expect(v).toBeGreaterThanOrEqual(152);
    }
  });

  it('holds the end values outside the keyframe range', () => {
    expect(interpolate(K, -30)).toBe(176);
    expect(interpolate(K, 500)).toBe(152);
  });

  it('throws on an empty curve', () => {
    expect(() => interpolate([], 0)).toThrow();
  });
});

describe('sample / sampleBand', () => {
  it('samples inclusively at the step', () => {
    const s = sample(K, 0, 100, 5);
    expect(s).toHaveLength(21);
    expect(s[0]).toEqual({ t: 0, v: 176 });
    expect(s[20]).toEqual({ t: 100, v: 152 });
  });

  it('builds a band that widens from its origin', () => {
    const band = sampleBand(K, 40, 100, 10, widening(4, 0.06, 40));
    expect(band[0].hi - band[0].lo).toBeCloseTo(8, 10);
    expect(band.at(-1)!.hi - band.at(-1)!.lo).toBeCloseTo(2 * (4 + 0.06 * 60), 10);
    for (const p of band) expect((p.hi + p.lo) / 2).toBeCloseTo(interpolate(K, p.t), 10);
  });

  it('finds the first time a curve reaches a threshold', () => {
    expect(firstAtOrBelow(K, 160, 0, 100)).toBe(85);
    expect(firstAtOrBelow(K, 100, 0, 100)).toBeNull();
  });
});
