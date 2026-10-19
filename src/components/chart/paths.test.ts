import { areaToLevel, bandPath, linear, linePath } from './paths';

describe('chart paths', () => {
  const x = linear(0, 600, 0, 600);
  const y = linear(40, 220, 250, 10);

  it('maps the overview y-axis as in the design: Y(v) = 250 − (v − 40)·240/180', () => {
    expect(y(40)).toBe(250);
    expect(y(220)).toBe(10);
    expect(y(70)).toBeCloseTo(210, 10);
  });

  it('clamps when asked', () => {
    const c = linear(60, 345, 290, 5, true);
    expect(c(400)).toBe(5);
    expect(c(60)).toBe(290);
  });

  it('builds line, band and area paths', () => {
    expect(linePath([{ t: 0, v: 40 }, { t: 10, v: 220 }], x, y)).toBe('M0 250 L10 10');
    expect(linePath([], x, y)).toBe('');
    expect(bandPath([{ t: 0, lo: 40, hi: 220 }, { t: 10, lo: 40, hi: 220 }], x, y)).toBe('M0 10 L10 10 L10 250 L0 250 Z');
    expect(areaToLevel([{ t: 0, v: 220 }, { t: 10, v: 220 }], 40, x, y)).toBe('M0 10 L10 10 L10 250 L0 250 Z');
  });
});
