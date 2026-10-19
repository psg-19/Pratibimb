import { DEFAULT_CONNECTED } from '../data/sources';
import {
  buildBlocker,
  readinessScore,
  readinessStatus,
  ringSegments,
  RING_ORDER,
  SOURCE_WEIGHTS,
  twinFigureState,
} from './readiness';
import type { SourceFlags } from './types';

const none: SourceFlags = { cgm: false, watch: false, abha: false, meals: false, bp: false };
const all: SourceFlags = { cgm: true, watch: true, abha: true, meals: true, bp: true };

describe('readiness score', () => {
  it('weights sum to 100', () => {
    expect(Object.values(SOURCE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('defaults to 60 % (CGM + ABHA)', () => {
    expect(readinessScore(DEFAULT_CONNECTED)).toBe(60);
  });

  it('is 0 with nothing and 100 with everything', () => {
    expect(readinessScore(none)).toBe(0);
    expect(readinessScore(all)).toBe(100);
  });

  it('adds each source’s weight', () => {
    expect(readinessScore({ ...DEFAULT_CONNECTED, watch: true })).toBe(80);
    expect(readinessScore({ ...none, bp: true, meals: true })).toBe(20);
  });
});

describe('ring segments', () => {
  const C = 2 * Math.PI * 64;

  it('lays connected sources end to end in CGM, ABHA, Watch, Meals, BP order', () => {
    const segs = ringSegments(all, C);
    expect(segs.map((s) => s.id)).toEqual(RING_ORDER);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeCloseTo(segs[i - 1].start + segs[i - 1].length, 10);
    expect(segs.reduce((a, s) => a + s.length, 0)).toBeCloseTo(C, 10);
  });

  it('gives disconnected sources zero length and closes the gap', () => {
    const segs = ringSegments(DEFAULT_CONNECTED, C);
    const by = Object.fromEntries(segs.map((s) => [s.id, s]));
    expect(by.watch.length).toBe(0);
    expect(by.abha.start).toBeCloseTo(by.cgm.length, 10);
    expect(segs.reduce((a, s) => a + s.length, 0)).toBeCloseTo(C * 0.6, 10);
  });
});

describe('readiness status and build gate', () => {
  it('cannot forecast without a CGM, whatever else is connected', () => {
    expect(readinessStatus({ ...all, cgm: false })).toBe('no-cgm');
  });

  it('forecasts with a wide band below 80 and is ready at 80+', () => {
    expect(readinessStatus(DEFAULT_CONNECTED)).toBe('wide-band');
    expect(readinessStatus({ ...DEFAULT_CONNECTED, watch: true })).toBe('ready');
    // Boundary: 35 + 25 + 15 = 75 is still wide; adding the BP cuff reaches exactly 80.
    expect(readinessStatus({ ...none, cgm: true, abha: true, meals: true })).toBe('wide-band');
    expect(readinessStatus({ ...none, cgm: true, abha: true, meals: true, bp: true })).toBe('ready');
  });

  it('locks “Build my twin” until CGM is connected and build consent is on', () => {
    expect(buildBlocker(DEFAULT_CONNECTED, true)).toBeNull();
    expect(buildBlocker(DEFAULT_CONNECTED, false)).toBe('no-consent');
    expect(buildBlocker({ ...DEFAULT_CONNECTED, cgm: false }, true)).toBe('no-cgm');
    expect(buildBlocker({ ...DEFAULT_CONNECTED, cgm: false }, false)).toBe('no-cgm');
  });

  it('drives the twin figure: mesh opacity, scan bar, solid outline', () => {
    expect(twinFigureState(none).meshOpacity).toBeCloseTo(0.15, 10);
    expect(twinFigureState(all).meshOpacity).toBeCloseTo(0.7, 10);
    expect(twinFigureState(DEFAULT_CONNECTED)).toMatchObject({ scanning: true, solid: false });
    expect(twinFigureState({ ...DEFAULT_CONNECTED, watch: true }).solid).toBe(true);
    expect(twinFigureState({ ...all, cgm: false }).scanning).toBe(false);
  });
});
