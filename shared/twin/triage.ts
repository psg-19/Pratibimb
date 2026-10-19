/** Turns a forecast into a care-team risk: kind, level, probability and a window in words. */
import { clockIST } from '../time';
import type { Forecast } from './forecast';

export type RiskKind = 'low' | 'high' | 'stable';
export type RiskLevel = 'High' | 'Medium' | 'Low';

export interface Risk {
  kind: RiskKind;
  level: RiskLevel;
  /** 0–1. */
  probability: number;
  /** "Low glucose likely overnight". */
  title: string;
  short: string;
  /** "Below 70 mg/dL between 02:15 and 03:30, lowest ≈ 65". */
  window: string;
}

export const LEVELS = { high: 0.55, medium: 0.2 } as const;

function levelOf(p: number): RiskLevel {
  return p >= LEVELS.high ? 'High' : p >= LEVELS.medium ? 'Medium' : 'Low';
}

/** Hours of the night: is the low "overnight" or "before dawn"? */
function lowPhrase(from: number, likely: boolean) {
  const h = Number(clockIST(from).slice(0, 2));
  const when = h >= 3 && h < 7 ? 'before dawn' : h >= 21 || h < 3 ? 'overnight' : 'in the next hours';
  return `Low glucose ${likely ? 'likely' : 'possible'} ${when}`;
}

export function assessRisk(fc: Forecast): Risk {
  const pHighish = Math.max(fc.pVeryHigh, fc.pHigh);
  const pLow = fc.pLow;
  if (pLow >= pHighish && pLow >= LEVELS.medium) {
    const level = levelOf(pLow);
    const w = fc.riskWindow ?? { from: fc.lowest.t, to: fc.lowest.t };
    return {
      kind: 'low',
      level,
      probability: pLow,
      title: lowPhrase(w.from, level === 'High'),
      short: level === 'High' ? 'Low likely' : 'Low possible',
      window:
        w.to - w.from >= 15
          ? `Below 70 mg/dL between ${clockIST(w.from)} and ${clockIST(w.to)}, lowest ≈ ${Math.round(fc.lowest.v)}`
          : `Lowest ≈ ${Math.round(fc.lowest.v)} mg/dL around ${clockIST(fc.lowest.t)}`,
    };
  }
  if (pHighish >= LEVELS.medium) {
    const level = levelOf(pHighish);
    const above250 = fc.median.filter((p) => p.v > 250).length / fc.median.length;
    // When does the median come back under 180?
    const back = fc.median.find((p, i) => i > 0 && p.v <= 180 && fc.median[i - 1].v > 180);
    const window =
      above250 >= 0.5
        ? 'Above 250 mg/dL for most of the night'
        : back
          ? `Above 180 mg/dL until about ${clockIST(back.t)}`
          : 'Above 180 mg/dL for most of the night';
    const persists = !back || back.t - fc.now > 4 * 60;
    return {
      kind: 'high',
      level,
      probability: pHighish,
      title: persists ? 'High glucose likely to persist' : `High glucose likely until about ${clockIST(back.t)}`,
      short: 'High persists',
      window,
    };
  }
  return {
    kind: 'stable',
    level: 'Low',
    probability: Math.max(pLow, pHighish),
    title: 'Stable within range',
    short: 'Stable',
    window: `Forecast stays between ${Math.round(fc.lowest.v / 5) * 5} and ${Math.round(fc.highest.v / 5) * 5} mg/dL`,
  };
}
