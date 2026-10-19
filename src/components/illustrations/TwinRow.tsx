import type { RiskLevel } from '../../../shared/twin/triage';
import { pulseStyle } from './motion';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);
const COLOR: Record<RiskLevel, string> = { High: 'var(--risk)', Medium: 'var(--warn)', Low: 'var(--g-dot)' };

/** Care header: one mini wireframe twin per patient, with a status dot (high risk pulses). */
export function TwinRow({ levels }: { levels: readonly RiskLevel[] }) {
  const n = (l: RiskLevel) => levels.filter((x) => x === l).length;
  const total = word(levels.length);
  const label = `${total.charAt(0).toUpperCase()}${total.slice(1)} patients, each watched by a digital twin: ${word(n('High'))} at high risk, ${word(n('Medium'))} medium, ${word(n('Low'))} low`;
  return (
    <svg width="300" height="100" viewBox="0 0 300 100" role="img" aria-label={label} style={{ display: 'block', maxWidth: '100%', height: 'auto' }}>
      {levels.map((level, i) => {
        const cx = 25 + i * 50;
        return (
          <g key={i}>
            <ellipse cx={cx} cy="93" rx="18" ry="4" style={{ fill: 'var(--b-bg)' }} />
            <g style={{ fill: 'var(--card)', stroke: 'var(--accent)' }} strokeWidth="1.3">
              <rect x={cx - 9} y="66" width="7" height="24" rx="3.5" />
              <rect x={cx + 2} y="66" width="7" height="24" rx="3.5" />
              <rect x={cx - 11} y="41" width="22" height="28" rx="9" />
              <circle cx={cx} cy="30" r="8" />
            </g>
            {level === 'High' ? <circle className="pulse" cx={cx} cy="10" r="5" fill="none" style={pulseStyle(2.6, COLOR.High)} strokeWidth="2" /> : null}
            <circle cx={cx} cy="10" r="5" style={{ fill: COLOR[level] }} />
          </g>
        );
      })}
    </svg>
  );
}
