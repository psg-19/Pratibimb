import { marchStyle } from './motion';

/** Live-twin header icon: Suresh and his wireframe twin joined by a moving dotted line. Decorative. */
export function TwinPair() {
  return (
    <svg width="60" height="52" viewBox="0 0 60 52" fill="none" aria-hidden="true">
      <circle cx="16" cy="10" r="6" style={{ fill: 'var(--o-mid)' }} />
      <rect x="10" y="34" width="5" height="15" rx="2.5" style={{ fill: 'var(--b-dot)' }} />
      <rect x="17" y="34" width="5" height="15" rx="2.5" style={{ fill: 'var(--b-dot)' }} />
      <rect x="9" y="18" width="14" height="19" rx="6" style={{ fill: 'var(--pk-mid)' }} />
      <g style={{ fill: 'var(--card)', stroke: 'var(--accent)' }} strokeWidth="1.2">
        <rect x="38" y="34" width="5" height="15" rx="2.5" />
        <rect x="45" y="34" width="5" height="15" rx="2.5" />
        <rect x="37" y="18" width="14" height="19" rx="6" />
        <circle cx="44" cy="10" r="6" />
      </g>
      <path className="stream" d="M25 27 L35 27" style={marchStyle(-12, '1.2s', 'var(--accent)')} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3 3" />
    </svg>
  );
}
