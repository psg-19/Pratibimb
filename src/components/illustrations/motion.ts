import type { CSSProperties } from 'react';

/** Per-element parameters for the shared keyframes in global.css (all stop under reduced motion). */
export const scanStyle = (from: number, to: number, dur: string): CSSProperties =>
  ({ '--scan-from': `${from}px`, '--scan-to': `${to}px`, '--scan-dur': dur }) as CSSProperties;

export const marchStyle = (to: number, dur: string, stroke: string): CSSProperties =>
  ({ '--march-to': to, '--march-dur': dur, stroke }) as CSSProperties;

export const pulseStyle = (scale: number, stroke: string): CSSProperties =>
  ({ '--pulse-scale': scale, stroke }) as CSSProperties;
