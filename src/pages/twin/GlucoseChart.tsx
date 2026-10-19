import type { CSSProperties } from 'react';
import type { ForecastDTO } from '../../../shared/api';
import { clockIST, minuteOfDayIST } from '../../../shared/time';
import { Area, ChartFrame, ChartText, Dot, HLine, Line, Rect, VGrid, VLine } from '../../components/chart/Chart';
import { bandPath, linear, linePath, pct } from '../../components/chart/paths';
import { PlateSmall } from '../../components/ui/icons';
import { useChartSize } from '../../hooks/useElementWidth';

/** Chart window: 6 h of history and up to 12 h ahead (1080 minutes), like the design. */
const SPAN = 1080;
const Y_DOMAIN = [40, 240] as const;
/** Vertical step between stacked meal-tag rows, px. */
const TAG_ROW = 26;

/**
 * Stacks meal tags into rows so neighbours never overlap: each tag goes in the first row where it
 * clears the previous tag. Widths are estimated from the label (12 px text, icon and padding).
 */
function tagRows(tags: { x: number; label: string; flip: boolean }[]): number[] {
  const ends: number[] = [];
  return tags.map(({ x, label, flip }) => {
    const w = 38 + label.length * 6.8;
    const [from, to] = flip ? [x - w, x] : [x, x + w];
    let row = ends.findIndex((end) => from >= end + 6);
    if (row < 0) row = ends.length;
    ends[row] = to;
    return Math.min(row, 2);
  });
}

interface Props {
  fc: ForecastDTO;
  hLabel: string;
  showMeals: boolean;
  showActivity: boolean;
}

export function GlucoseChart({ fc, hLabel, showMeals, showActivity }: Props) {
  const size = useChartSize<HTMLDivElement>({ w: 1080, h: 320 }, { w: 480, h: 320 }, 560);
  const { w: W, h: H, compact } = size;
  const from = fc.from;
  const x = linear(from, from + SPAN, 0, W);
  const y = linear(Y_DOMAIN[0], Y_DOMAIN[1], H - 20, 20);
  const at = (t: number) => `${(((t - from) / SPAN) * 100).toFixed(2)}%`;
  const inView = (t: number) => t >= from && t <= from + SPAN;

  // Grid and axis on IST clock hours divisible by four.
  const ticks: number[] = [];
  for (let t = from; t <= from + SPAN; t++) if (minuteOfDayIST(t) % 240 === 0) ticks.push(t);

  const meals = fc.meals.filter((m) => inView(m.t) && (!m.planned || m.t <= fc.end)).sort((a, b) => a.t - b.t);
  const px = size.width ?? W;
  const flipAt = (t: number) => (t - from) / SPAN > 0.75;
  const rows = tagRows(meals.map((m) => ({ x: ((m.t - from) / SPAN) * px, label: compact ? m.compact : m.label, flip: flipAt(m.t) })));
  const walks = fc.walks.filter((w) => w.to >= from);
  const sleep = fc.sleep && fc.sleep.from < fc.end ? { ...fc.sleep, to: Math.min(fc.sleep.to, fc.end) } : null;

  const lowest = fc.readout.lowest;
  const label =
    `Glucose for the last 6 hours measured, then the twin's forecast for the next ${hLabel}. ` +
    `Forecast low ${Math.round(lowest.v)} mg/dL at ${clockIST(lowest.t)}.` +
    (fc.riskWindow ? ` Low risk window ${clockIST(fc.riskWindow.from)} to ${clockIST(fc.riskWindow.to)}.` : '') +
    (fc.scenario ? ' A second line shows the night with the bedtime snack.' : '');

  const now = fc.now;
  const latestV = fc.latest?.mgdl ?? fc.measured.at(-1)?.v ?? lowest.v;

  return (
    <div ref={size.ref}>
      <ChartFrame
        width={W}
        height={H}
        label={label}
        className="tw-chart"
        overlay={
          <>
            {fc.end < from + SPAN ? (
              <div className="tw-veil" style={{ left: at(fc.end) }}>
                <span>Beyond the {hLabel} horizon</span>
              </div>
            ) : null}
            <ChartText style={{ right: pct(6, W), top: pct(y(180) - 6, H), transform: 'translateY(-100%)', color: 'var(--dim)', fontSize: 12 }}>180</ChartText>
            <ChartText style={{ right: pct(6, W), top: pct(y(70) + 4, H), color: 'var(--risk)', fontSize: 12 }}>70 mg/dL</ChartText>

            <div className="chart-tag tw-now" style={{ left: at(now) }} aria-hidden="true">
              Now
            </div>
            {fc.riskWindow ? (
              <div className="rise chart-tag tw-risk-tag" style={{ left: at((fc.riskWindow.from + fc.riskWindow.to) / 2) }} aria-hidden="true">
                {compact ? 'Low risk' : 'Low risk window'}
              </div>
            ) : null}

            {showMeals
              ? meals.map((m, i) => {
                  const flip = flipAt(m.t);
                  const top = 38 + rows[i] * TAG_ROW;
                  const style: CSSProperties = flip ? { top, right: `${(100 - ((m.t - from) / SPAN) * 100).toFixed(2)}%`, alignItems: 'flex-end' } : { top, left: at(m.t) };
                  return (
                    <div key={`${m.t}-${m.label}`} className="rise tw-meal" style={style} aria-hidden="true">
                      <span className="tw-meal__tag" style={{ borderStyle: m.planned ? 'dashed' : 'solid' }}>
                        <PlateSmall />
                        {compact ? m.compact : m.label}
                      </span>
                      <span className="tw-meal__stem" />
                    </div>
                  );
                })
              : null}

            {showActivity ? (
              <>
                {walks.map((w) => (
                  <div key={w.from}>
                    <div className="rise tw-walk" style={{ left: at(Math.max(w.from, from)), width: `${(((w.to - Math.max(w.from, from)) / SPAN) * 100).toFixed(2)}%` }} aria-hidden="true" />
                    <div className="rise tw-walk-label" style={{ left: at(Math.max(from, w.from - 14)) }} aria-hidden="true">
                      {w.label}
                    </div>
                  </div>
                ))}
                {sleep && inView(sleep.from) ? (
                  <div className="rise tw-sleep" style={{ left: at(sleep.from), width: `${(((sleep.to - sleep.from) / SPAN) * 100).toFixed(2)}%` }} aria-hidden="true">
                    {sleep.label}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        }
      >
        <Rect x={0} y={y(180)} width={W} height={y(70) - y(180)} color="var(--accent)" opacity={0.06} />
        <VGrid xs={ticks.map(x)} height={H} />
        <HLine y={y(180)} x2={W} color="var(--line-strong)" dash="3 5" />
        <HLine y={y(70)} x2={W} color="var(--risk)" width={1.2} dash="5 5" />
        {fc.riskWindow ? <Rect x={x(fc.riskWindow.from)} y={0} width={x(fc.riskWindow.to) - x(fc.riskWindow.from)} height={H} color="var(--risk)" opacity={0.13} /> : null}
        <Area d={bandPath(fc.band, x, y)} color="var(--accent)" opacity={0.17} />
        <Line d={linePath(fc.measured, x, y)} color="var(--ink)" width={2.6} />
        <Line d={linePath(fc.median, x, y)} color="var(--accent)" width={2.2} dash="7 6" />
        {fc.scenario ? <Line d={linePath(fc.scenario, x, y)} color="var(--accent)" width={2.8} /> : null}
        <VLine x={x(now)} y2={H} color="var(--ink)" width={1.2} opacity={0.55} />
        <Dot x={x(now)} y={y(latestV)} r={6} fill="var(--ink)" ringWidth={3} />
      </ChartFrame>
      <div className="axis axis--placed" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: at(t) }}>
            {clockIST(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
