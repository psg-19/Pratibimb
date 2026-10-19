import { useMemo, useState } from 'react';
import { Area, ChartFrame, ChartText, Dot, HLine, Line, Rect, VGrid, VLine } from '../../components/chart/Chart';
import { areaToLevel, bandPath, linear, linePath, pct } from '../../components/chart/paths';
import { Legend, type LegendItem } from '../../components/ui/Legend';
import { Segmented } from '../../components/ui/Segmented';
import { OVERNIGHT } from '../../data/overnight';
import { useChartSize } from '../../hooks/useElementWidth';
import { LOW_THRESHOLD, overnightView, type CareMode } from '../../model/overnight';
import { formatLead } from '../../model/time';

const MODES = [
  { value: 'reactive', label: 'Reactive care' },
  { value: 'proactive', label: 'Proactive care' },
] as const;

const COPY = {
  proactive: {
    marker: '00:10 · Twin: low likely by 02:40',
    note: 'At 00:10 the twin forecasts a low near 02:40 and suggests a 15 g bedtime snack. With it, the simulated night stays above 85 mg/dL.',
    chart: 'Overnight glucose with twin forecast: alert at 00:10, forecast low near 02:40; with a 15 g snack the night stays above 85 mg/dL',
  },
  reactive: {
    marker: '02:40 · CGM alarm: 70 mg/dL, falling',
    note: 'The CGM alarm sounds at 02:40, once glucose has already reached 70 mg/dL. Suresh is asleep, and the low deepens to 60 by 03:50.',
    chart: 'Overnight glucose without forecasting: falls below 70 mg/dL at 02:40 and reaches 60 by 03:50; the CGM alarm sounds at 02:40',
  },
} as const;

const LEGEND: Record<CareMode, LegendItem[]> = {
  proactive: [
    { label: 'Measured', color: 'var(--ink)', width: 2 },
    { label: 'Twin forecast ± uncertainty', color: 'var(--accent)', width: 2, dash: 'dashed' },
    { label: 'With a 15 g snack at 00:10', color: 'var(--accent)', width: 3 },
    { label: 'Target 70–180', color: 'var(--accent-mid)', width: 8 },
  ],
  reactive: [
    { label: 'Measured', color: 'var(--ink)', width: 2 },
    { label: 'Below 70 mg/dL', color: 'var(--risk)', width: 6 },
    { label: 'Target 70–180', color: 'var(--accent-mid)', width: 8 },
  ],
};

const AXIS = ['20:00', '22:00', '00:00', '02:00', '04:00', '06:00'];

export function OvernightDemo({ startMode = 'proactive' }: { startMode?: CareMode }) {
  const [mode, setMode] = useState<CareMode>(startMode);
  const view = useMemo(() => overnightView(mode), [mode]);
  const size = useChartSize<HTMLDivElement>({ w: 600, h: 260 }, { w: 360, h: 300 });
  const { w: W, h: H } = size;

  const x = linear(0, OVERNIGHT.duration, 0, W);
  const y = linear(OVERNIGHT.yDomain[0], OVERNIGHT.yDomain[1], H - 10, 10);
  const pro = mode === 'proactive';
  const markColor = pro ? 'var(--accent)' : 'var(--risk)';
  const markX = x(view.marker.t);
  const copy = COPY[mode];
  const left = view.marker.t / OVERNIGHT.duration;

  return (
    <div className="ov-demo">
      <div className="ov-demo__head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="display ov-demo__title">One night, two kinds of care</h2>
          <span className="ov-demo__sub">Suresh R., 54 · synthetic patient · 20:00 → 06:00</span>
        </div>
        <Segmented label="Care model" options={MODES} value={mode} onChange={setMode} />
      </div>

      <div ref={size.ref}>
        <ChartFrame
          width={W}
          height={H}
          label={copy.chart}
          overlay={
            <>
              <ChartText style={{ left: pct(4, W), top: pct(y(LOW_THRESHOLD) - 6, H), transform: 'translateY(-100%)', color: 'var(--risk)' }}>
                70 mg/dL
              </ChartText>
              <ChartText style={{ left: pct(4, W), top: pct(y(180) - 6, H), transform: 'translateY(-100%)', color: 'var(--dim)' }}>180</ChartText>
              <div
                key={mode}
                className="rise ov-demo__tag"
                aria-hidden="true"
                style={
                  pro
                    ? { left: `${left * 100}%`, transform: 'translateX(12px)', maxWidth: `calc(${(1 - left) * 100}% - 12px)`, borderColor: markColor }
                    : { left: `${left * 100}%`, transform: 'translateX(calc(-100% - 12px))', maxWidth: `calc(${left * 100}% - 12px)`, borderColor: markColor }
                }
              >
                {copy.marker}
              </div>
            </>
          }
        >
          <Rect x={0} y={y(180)} width={W} height={y(LOW_THRESHOLD) - y(180)} color="var(--accent)" opacity={0.06} />
          <VGrid xs={[120, 240, 360, 480].map(x)} height={H} />
          <HLine y={y(LOW_THRESHOLD)} x2={W} color="var(--risk)" dash="4 4" />
          <Area d={view.belowLow.length ? areaToLevel(view.belowLow, LOW_THRESHOLD, x, y) : ''} color="var(--risk)" opacity={0.32} />
          <Area d={bandPath(view.band, x, y)} color="var(--accent)" opacity={0.16} />
          <Line d={linePath(view.measured, x, y)} color="var(--ink)" width={2.4} />
          <Line d={linePath(view.forecast, x, y)} color="var(--accent)" width={2} dash="6 5" />
          <Line d={linePath(view.snack, x, y)} color="var(--accent)" width={2.6} />
          <VLine x={markX} y2={H} color={markColor} width={1.5} />
          <Dot x={markX} y={y(view.marker.v)} r={5.5} fill={markColor} ringWidth={2.5} />
        </ChartFrame>
      </div>
      <div className="axis axis--spread" aria-hidden="true">
        {AXIS.map((a) => (
          <span key={a}>{a}</span>
        ))}
      </div>

      <Legend items={LEGEND[mode]} label="Chart legend" />

      <div className="ov-demo__foot">
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">Warning lead time</span>
          <span className="display ov-demo__lead" style={{ color: markColor }}>
            {formatLead(view.leadMinutes)}
          </span>
        </div>
        <p className="ov-demo__note" aria-live="polite">
          {copy.note}
        </p>
      </div>
    </div>
  );
}
