import { SOURCES } from '../../data/sources';
import { twinFigureState } from '../../model/readiness';
import type { SourceFlags } from '../../model/types';
import { scanStyle } from './motion';
import { useSvgId } from './useSvgId';

function Body({ outline = false }: { outline?: boolean }) {
  return (
    <>
      <circle cx="120" cy="46" r="22" />
      {outline ? null : <rect x="113" y="64" width="14" height="16" rx="5" />}
      <rect x="92" y="76" width="56" height="100" rx="24" />
      <rect x="72" y="82" width="16" height="92" rx="8" />
      <rect x="152" y="82" width="16" height="92" rx="8" />
      <rect x="98" y="170" width="18" height="96" rx="9" />
      <rect x="124" y="170" width="18" height="96" rx="9" />
    </>
  );
}

/**
 * Connect screen: a wireframe twin that lights up per connected source —
 * CGM arm node, watch wrist + legs, ABHA torso, meals stomach node, BP heart node.
 * The outline turns solid once readiness reaches 80 %.
 */
export function TwinFigure({ on, score }: { on: SourceFlags; score: number }) {
  const clip = useSvgId('cBody');
  const fig = twinFigureState(on, score);
  const node = (id: keyof SourceFlags, hue: string) => (on[id] ? `var(--${hue}-dot)` : 'var(--grid)');
  const lit = SOURCES.filter((s) => on[s.id]).map((s) => s.figureName.toLowerCase());
  const label = lit.length ? `Twin figure lit up by ${lit.join(', ')}` : 'Twin figure with no data connected yet';

  return (
    <svg viewBox="0 0 240 290" width="100%" role="img" aria-label={label} style={{ display: 'block', height: 'auto', maxWidth: 230 }}>
      <defs>
        <clipPath id={clip}>
          <Body />
        </clipPath>
      </defs>
      <ellipse cx="120" cy="272" rx="84" ry="14" style={{ fill: 'var(--b-bg)', stroke: 'var(--b-mid)' }} strokeWidth="1.5" />
      <g style={{ fill: 'var(--card)' }}>
        <Body />
      </g>
      <rect className="node-lit" x="92" y="76" width="56" height="100" rx="24" style={{ fill: 'var(--y-mid)' }} opacity={on.abha ? 0.75 : 0} />
      <rect className="node-lit" x="98" y="170" width="18" height="96" rx="9" style={{ fill: 'var(--g-mid)' }} opacity={on.watch ? 0.7 : 0} />
      <rect className="node-lit" x="124" y="170" width="18" height="96" rx="9" style={{ fill: 'var(--g-mid)' }} opacity={on.watch ? 0.7 : 0} />
      <g clipPath={`url(#${clip})`} opacity={fig.meshOpacity.toFixed(2)} className="node-lit">
        <g style={{ stroke: 'var(--accent)' }} strokeWidth="1">
          {Array.from({ length: 24 }, (_, i) => 28 + i * 10).map((y) => (
            <line key={y} x1="60" x2="180" y1={y} y2={y} />
          ))}
        </g>
        {fig.scanning ? (
          <rect className="scan" x="60" y="0" width="120" height="10" style={{ fill: 'var(--accent)', ...scanStyle(24, 262, '4s') }} opacity="0.35" />
        ) : null}
      </g>
      <g fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="1.5" strokeDasharray={fig.solid ? undefined : '4 3'}>
        <Body outline />
      </g>
      <circle className="node-lit" cx="160" cy="104" r="7" style={{ fill: node('cgm', 'b'), stroke: 'var(--card)' }} strokeWidth="2" />
      <rect className="node-lit" x="70" y="156" width="20" height="14" rx="4" style={{ fill: node('watch', 'g'), stroke: 'var(--card)' }} strokeWidth="2" />
      <circle className="node-lit" cx="130" cy="102" r="6" style={{ fill: node('bp', 'pk'), stroke: 'var(--card)' }} strokeWidth="2" />
      <circle className="node-lit" cx="120" cy="140" r="7" style={{ fill: node('meals', 'o'), stroke: 'var(--card)' }} strokeWidth="2" />
    </svg>
  );
}
