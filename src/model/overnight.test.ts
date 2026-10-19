import { overnightView } from './overnight';
import { clock, formatLead } from './time';

describe('One night, two kinds of care', () => {
  it('proactive: the twin alerts at 00:10 with 2 h 30 min of warning', () => {
    const v = overnightView('proactive');
    expect(clock(20 * 60, v.marker.t)).toBe('00:10');
    expect(formatLead(v.leadMinutes)).toBe('2 h 30 min');
    expect(v.measured.at(-1)!.t).toBe(250);
    expect(v.forecast[0].t).toBe(250);
    expect(v.belowLow).toHaveLength(0);
  });

  it('proactive: the snack scenario starts on the curve and stays above 85', () => {
    const v = overnightView('proactive');
    expect(v.snack[0].v).toBeCloseTo(v.marker.v, 10);
    for (const p of v.snack) expect(p.v).toBeGreaterThan(85);
  });

  it('reactive: the CGM alarm fires at 02:40 with 0 min of warning', () => {
    const v = overnightView('reactive');
    expect(clock(20 * 60, v.marker.t)).toBe('02:40');
    expect(v.marker.v).toBe(70);
    expect(formatLead(v.leadMinutes)).toBe('0 min');
    expect(v.forecast).toHaveLength(0);
    expect(Math.max(...v.belowLow.map((p) => p.v))).toBe(70);
    expect(Math.min(...v.belowLow.map((p) => p.v))).toBe(60);
  });
});

describe('time formatting', () => {
  it('formats clocks, wrapping past midnight', () => {
    expect(clock(15 * 60 + 40, 0)).toBe('15:40');
    expect(clock(15 * 60 + 40, 690)).toBe('03:10');
    expect(clock(20 * 60, 600)).toBe('06:00');
  });

  it('formats lead times', () => {
    expect(formatLead(150)).toBe('2 h 30 min');
    expect(formatLead(60)).toBe('1 h');
    expect(formatLead(45)).toBe('45 min');
    expect(formatLead(-5)).toBe('0 min');
  });
});
