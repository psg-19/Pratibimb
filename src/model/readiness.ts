import type { SourceFlags, SourceId } from './types';

/** How much each source contributes to twin readiness (%). */
export const SOURCE_WEIGHTS: Record<SourceId, number> = { cgm: 35, abha: 25, watch: 20, meals: 15, bp: 5 };

/** Ring segment order. */
export const RING_ORDER: readonly SourceId[] = ['cgm', 'abha', 'watch', 'meals', 'bp'];

export const READY_THRESHOLD = 80;

export function readinessScore(on: SourceFlags, weights = SOURCE_WEIGHTS): number {
  return (Object.keys(weights) as SourceId[]).reduce((sum, id) => sum + (on[id] ? weights[id] : 0), 0);
}

export interface RingSegment {
  id: SourceId;
  /** Arc length along the ring. */
  length: number;
  /** Where the arc starts (cumulative length of the connected sources before it). */
  start: number;
}

/** One coloured arc per connected source, laid end to end, sized by weight. */
export function ringSegments(on: SourceFlags, circumference: number, weights = SOURCE_WEIGHTS): RingSegment[] {
  let start = 0;
  return RING_ORDER.map((id) => {
    const length = on[id] ? (circumference * weights[id]) / 100 : 0;
    const seg = { id, length, start };
    start += length;
    return seg;
  });
}

export type ReadinessStatus = 'no-cgm' | 'wide-band' | 'ready';

export function readinessStatus(on: SourceFlags, score = readinessScore(on)): ReadinessStatus {
  if (!on.cgm) return 'no-cgm';
  return score < READY_THRESHOLD ? 'wide-band' : 'ready';
}

export const STATUS_COPY: Record<ReadinessStatus, { title: string; note: string }> = {
  'no-cgm': {
    title: 'Can’t forecast yet',
    note: 'Connect a glucose monitor first — the twin needs it to learn how your glucose rises and falls.',
  },
  'wide-band': {
    title: 'Forecasts with a wide band',
    note: 'Enough to start. Every extra source narrows the forecast and makes alerts more specific to you.',
  },
  ready: {
    title: 'Ready for 6-hour forecasts',
    note: 'Strong signal from food, movement, sleep and records. The twin keeps personalising as days of data build up.',
  },
};

export type BuildBlocker = 'no-cgm' | 'no-consent' | null;

/** "Build my twin" needs the CGM connected and consent to build the twin. */
export function buildBlocker(on: SourceFlags, consentBuild: boolean): BuildBlocker {
  if (!on.cgm) return 'no-cgm';
  if (!consentBuild) return 'no-consent';
  return null;
}

export const BUILD_NOTE: Record<'no-cgm' | 'no-consent' | 'ok', string> = {
  'no-cgm': 'Connect a glucose monitor to continue.',
  'no-consent': 'Allow the twin to use your data to continue.',
  ok: 'Next: the twin fits your physiology from the data so far.',
};

/** Visual state of the TwinFigure illustration. */
export function twinFigureState(on: SourceFlags, score = readinessScore(on)) {
  return {
    meshOpacity: 0.15 + (score / 100) * 0.55,
    scanning: on.cgm,
    solid: score >= READY_THRESHOLD,
  };
}
