import { ChartFrame, HLine, Line, Rect } from '../components/chart/Chart';
import { bandPath, linear, linePath } from '../components/chart/paths';
import { usePageTitle } from '../hooks/usePageTitle';
import { overnightView } from '../model/overnight';
import { usePalette } from '../theme/PaletteContext';
import { PALETTES, type PaletteId } from '../theme/palettes.gen';
import './palettes.css';

const view = overnightView('proactive');
const x = linear(0, 600, 0, 600);
const y = linear(40, 220, 250, 10);

/** Design-review board: the same components in all six palettes. Not linked from the nav. */
export function Palettes() {
  usePageTitle('Palette options');
  const { palette, setPalette } = usePalette();
  return (
    <div className="wrap pl-main">
      <div className="pl-head">
        <h1 className="h-page">Palette options</h1>
        <span className="mono pl-sub">Mixed pastels first, then single-accent palettes</span>
      </div>
      <div className="pl-grid">
        {PALETTES.map((p) => (
          <section key={p.id} data-palette={p.id} className="pl-card" aria-labelledby={`pl-${p.id}`}>
            <div className="pl-card__head">
              <h2 id={`pl-${p.id}`} className="display pl-card__name">
                {p.name}
              </h2>
              <button
                type="button"
                className="btn btn-ghost pl-use"
                aria-pressed={palette === p.id}
                onClick={() => setPalette(p.id as PaletteId)}
              >
                {palette === p.id ? 'In use' : 'Use'}
              </button>
            </div>
            <div className="pl-tiles">
              {(['g', 'o', 'b', 'pk'] as const).map((h, i) => (
                <span key={h} className={`pl-tile hue-${h}`}>
                  <span className="pl-tile__l">{['In range', 'Steps', 'Sleep', 'Heart'][i]}</span>
                  <span className="display pl-tile__v">{['74%', '6,240', '6 h 10', '72 bpm'][i]}</span>
                </span>
              ))}
            </div>
            <div className="pl-chart">
              <span className="label label--sm">Overnight glucose · twin forecast</span>
              <ChartFrame width={600} height={260} label={`Sample glucose chart in ${p.name}`}>
                <Rect x={0} y={y(180)} width={600} height={y(70) - y(180)} color="var(--accent)" opacity={0.07} />
                <HLine y={y(70)} x2={600} color="var(--risk)" width={1.6} dash="6 6" />
                <path d={bandPath(view.band, x, y)} style={{ fill: 'var(--accent)' }} fillOpacity={0.16} />
                <Line d={linePath(view.measured, x, y)} color="var(--ink)" width={3.2} />
                <Line d={linePath(view.forecast, x, y)} color="var(--accent)" width={2.6} dash="8 7" />
                <Line d={linePath(view.snack, x, y)} color="var(--accent)" width={3.4} />
              </ChartFrame>
            </div>
            <div className="pl-alert">
              <span className="label label--sm" style={{ color: 'var(--risk-deep)' }}>
                Forecast · issued 21:40
              </span>
              <span className="display" style={{ fontSize: 19, lineHeight: 1.15 }}>
                Likely low tonight, while he sleeps
              </span>
              <button type="button" className="btn btn-risk" style={{ minHeight: 44, padding: '0 14px', fontSize: 12, alignSelf: 'flex-start' }}>
                Suggest a bedtime snack
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
