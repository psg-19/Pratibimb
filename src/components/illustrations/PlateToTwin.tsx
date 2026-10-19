import { marchStyle } from './motion';

const MONO = 'IBM Plex Mono, monospace';

/** What-if header: tonight's dinner plate → dotted arrow → wireframe twin with a rising curve. */
export function PlateToTwin() {
  return (
    <svg
      width="300"
      height="150"
      viewBox="0 0 300 150"
      role="img"
      aria-label="Tonight’s dinner is tried on Suresh’s twin first, which predicts how his glucose will rise"
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
    >
      <ellipse cx="70" cy="92" rx="60" ry="30" style={{ fill: 'var(--card)', stroke: 'var(--line)' }} strokeWidth="1.5" />
      <ellipse cx="70" cy="90" rx="44" ry="20" fill="none" style={{ stroke: 'var(--rule)' }} strokeWidth="1.5" />
      {/* rice, dal, sabzi, chapati */}
      <ellipse cx="56" cy="86" rx="18" ry="10" style={{ fill: 'var(--y-bg)', stroke: 'var(--y-mid)' }} strokeWidth="1.5" />
      <circle cx="88" cy="84" r="10" style={{ fill: 'var(--y-mid)' }} />
      <ellipse cx="84" cy="99" rx="13" ry="6" style={{ fill: 'var(--g-mid)' }} />
      <ellipse cx="60" cy="100" rx="14" ry="6" style={{ fill: 'var(--o-mid)' }} />
      <text x="70" y="142" textAnchor="middle" fontSize="11" fontFamily={MONO} style={{ fill: 'var(--dim)' }}>
        tonight’s dinner
      </text>
      <path className="stream" d="M138 90 L184 90" fill="none" style={marchStyle(-26, '1.3s', 'var(--accent)')} strokeWidth="2" strokeLinecap="round" strokeDasharray="6 7" />
      <path d="M179 84 L187 90 L179 96" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <g style={{ fill: 'var(--b-bg)', stroke: 'var(--accent)' }} strokeWidth="1.4">
        <rect x="227" y="96" width="10" height="34" rx="5" />
        <rect x="239" y="96" width="10" height="34" rx="5" />
        <rect x="214" y="62" width="8" height="34" rx="4" />
        <rect x="254" y="62" width="8" height="34" rx="4" />
        <rect x="224" y="58" width="28" height="42" rx="12" />
        <circle cx="238" cy="42" r="12" />
      </g>
      <g style={{ stroke: 'var(--accent)' }} strokeWidth="1" opacity="0.35">
        <line x1="226" x2="250" y1="68" y2="68" />
        <line x1="225" x2="251" y1="78" y2="78" />
        <line x1="225" x2="251" y1="88" y2="88" />
        <line x1="229" x2="247" y1="38" y2="38" />
        <line x1="229" x2="247" y1="46" y2="46" />
      </g>
      <path d="M260 36 C268 16 280 12 292 28" fill="none" style={{ stroke: 'var(--o-dot)' }} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="276" cy="17" r="3" style={{ fill: 'var(--o-dot)' }} />
      <text x="238" y="146" textAnchor="middle" fontSize="11" fontFamily={MONO} style={{ fill: 'var(--dim)' }}>
        his twin
      </text>
    </svg>
  );
}
