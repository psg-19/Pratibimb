import type { BandPoint, Series } from '../../model/types';

export type Scale = (v: number) => number;

/** Linear map from [d0, d1] to [r0, r1]; optionally clamps the input to the domain. */
export function linear(d0: number, d1: number, r0: number, r1: number, clamp = false): Scale {
  const k = (r1 - r0) / (d1 - d0);
  return (v) => {
    const x = clamp ? Math.min(Math.max(v, Math.min(d0, d1)), Math.max(d0, d1)) : v;
    return r0 + (x - d0) * k;
  };
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** "M x y L x y …" through the series. Empty string for an empty series. */
export function linePath(series: readonly { t: number; v: number }[], x: Scale, y: Scale): string {
  return series.map((p, i) => `${i ? 'L' : 'M'}${fmt(x(p.t))} ${fmt(y(p.v))}`).join(' ');
}

/** Closed band: along the upper edge, back along the lower edge. */
export function bandPath(band: readonly BandPoint[], x: Scale, y: Scale): string {
  if (band.length === 0) return '';
  const upper = band.map((p, i) => `${i ? 'L' : 'M'}${fmt(x(p.t))} ${fmt(y(p.hi))}`);
  const lower = [...band].reverse().map((p) => `L${fmt(x(p.t))} ${fmt(y(p.lo))}`);
  return `${upper.join(' ')} ${lower.join(' ')} Z`;
}

/** Area between a series and a horizontal level (e.g. the part of a curve above 180). */
export function areaToLevel(series: Series, level: number, x: Scale, y: Scale): string {
  if (series.length === 0) return '';
  const first = series[0].t;
  const last = series[series.length - 1].t;
  return `${linePath(series, x, y)} L${fmt(x(last))} ${fmt(y(level))} L${fmt(x(first))} ${fmt(y(level))} Z`;
}

/** Percentage helper for HTML overlays positioned over an SVG with a known width. */
export const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(2)}%`;
