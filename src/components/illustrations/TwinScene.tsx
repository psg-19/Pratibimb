import { marchStyle, pulseStyle, scanStyle } from './motion';
import { useSvgId } from './useSvgId';

const MONO = 'IBM Plex Mono, monospace';
const SANS = 'IBM Plex Sans, sans-serif';

/** Body silhouette shared by the twin's fill, clip path and outline. */
function TwinBody({ outline = false }: { outline?: boolean }) {
  return (
    <>
      <circle cx="380" cy="104" r="32" />
      {outline ? null : <rect x="372" y="132" width="16" height="22" rx="6" />}
      <rect x="344" y="150" width="72" height="128" rx="30" />
      <rect x="322" y="158" width="20" height="118" rx="10" />
      <rect x="418" y="158" width="20" height="118" rx="10" />
      <rect x="356" y="268" width="22" height="140" rx="11" />
      <rect x="382" y="268" width="22" height="140" rx="11" />
    </>
  );
}

function Stream({ y, label, color, bend = 10 }: { y: number; label: string; color: string; bend?: number }) {
  return (
    <>
      <text x="260" y={y - 14} textAnchor="middle" fontSize="11" fontFamily={MONO} style={{ fill: 'var(--muted)' }}>
        {label}
      </text>
      <path
        className="stream"
        d={`M206 ${y} C240 ${y - bend} 280 ${y - bend} 312 ${y}`}
        fill="none"
        style={marchStyle(-28, '1.4s', color)}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray="6 8"
      />
      <path d={`M306 ${y - 7} L314 ${y} L305 ${y + 6}`} fill="none" style={{ stroke: color }} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function SensorNode({ cx, cy, color, pulse }: { cx: number; cy: number; color: string; pulse?: boolean }) {
  return (
    <>
      {pulse ? <circle className="pulse" cx={cx} cy={cy} r="5" fill="none" style={pulseStyle(3, color)} strokeWidth="2" /> : null}
      <circle cx={cx} cy={cy} r="5" style={{ fill: 'var(--card)', stroke: color }} strokeWidth="2" />
    </>
  );
}

/** Overview hero: Suresh, his body-scan twin and the three data streams between them. */
export function TwinScene() {
  const clip = useSvgId('twinBody');
  const range = Array.from({ length: 28 }, (_, i) => 76 + i * 12);
  return (
    <svg
      viewBox="0 0 520 470"
      width="100%"
      role="img"
      aria-label="Suresh wears a glucose sensor and a smartwatch. His glucose, health-record and activity data stream into his digital twin, which forecasts the next six hours."
      style={{ display: 'block', height: 'auto', maxWidth: 580 }}
    >
      <defs>
        <clipPath id={clip}>
          <TwinBody />
        </clipPath>
      </defs>

      {/* Pedestals */}
      <ellipse cx="140" cy="420" rx="104" ry="22" style={{ fill: 'var(--pk-bg)', stroke: 'var(--pk-mid)' }} strokeWidth="1.5" />
      <ellipse cx="380" cy="420" rx="104" ry="22" style={{ fill: 'var(--b-bg)', stroke: 'var(--b-mid)' }} strokeWidth="1.5" />
      <ellipse cx="380" cy="420" rx="124" ry="30" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="1.2" strokeDasharray="3 6" opacity="0.6" />

      {/* Suresh */}
      <rect x="116" y="268" width="22" height="140" rx="11" style={{ fill: 'var(--b-mid)' }} />
      <rect x="142" y="268" width="22" height="140" rx="11" style={{ fill: 'var(--b-mid)' }} />
      <rect x="82" y="158" width="20" height="118" rx="10" style={{ fill: 'var(--o-mid)' }} />
      <rect x="178" y="158" width="20" height="118" rx="10" style={{ fill: 'var(--o-mid)' }} />
      <rect x="104" y="150" width="72" height="128" rx="30" style={{ fill: 'var(--pk-mid)' }} />
      <rect x="132" y="132" width="16" height="22" rx="6" style={{ fill: 'var(--o-mid)' }} />
      <circle cx="140" cy="104" r="32" style={{ fill: 'var(--o-mid)' }} />
      <path d="M108 102 C108 78 124 70 140 70 C158 70 172 80 172 102 C164 90 152 86 140 86 C128 86 116 92 108 102 Z" style={{ fill: 'var(--soft-ink)' }} />
      {/* Smartwatch */}
      <rect x="80" y="244" width="24" height="18" rx="5" style={{ fill: 'var(--ink)' }} />
      <rect x="84" y="248" width="16" height="10" rx="2" style={{ fill: 'var(--g-dot)' }} />
      {/* Glucose sensor */}
      <circle cx="188" cy="182" r="8" style={{ fill: 'var(--card)', stroke: 'var(--b-ink)' }} strokeWidth="2" />
      <circle cx="188" cy="182" r="3" style={{ fill: 'var(--b-dot)' }} />

      {/* Twin: fill, scan mesh, outline */}
      <g style={{ fill: 'var(--b-bg)' }}>
        <TwinBody />
      </g>
      <g clipPath={`url(#${clip})`}>
        <g style={{ stroke: 'var(--accent)' }} strokeWidth="1" opacity="0.32">
          {range.map((y) => (
            <line key={y} x1="300" x2="460" y1={y} y2={y} />
          ))}
        </g>
        <g style={{ stroke: 'var(--accent)' }} strokeWidth="1" opacity="0.18">
          {[356, 368, 380, 392, 404].map((x) => (
            <line key={x} x1={x} x2={x} y1="60" y2="410" />
          ))}
        </g>
        <rect className="scan" x="300" y="0" width="160" height="14" style={{ fill: 'var(--accent)', ...scanStyle(70, 392, '4.5s') }} opacity="0.22" />
      </g>
      <g fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="1.6">
        <TwinBody outline />
      </g>
      <SensorNode cx={332} cy={253} color="var(--g-dot)" pulse />
      <SensorNode cx={428} cy={182} color="var(--b-dot)" pulse />
      <SensorNode cx={392} cy={192} color="var(--pk-dot)" />
      <SensorNode cx={380} cy={236} color="var(--o-dot)" />

      {/* Data streams */}
      <Stream y={184} label="glucose" color="var(--b-dot)" bend={12} />
      <Stream y={228} label="health record" color="var(--y-dot)" />
      <Stream y={264} label="activity" color="var(--g-dot)" />

      {/* Live chip */}
      <rect x="40" y="10" width="200" height="40" rx="12" style={{ fill: 'var(--card)', stroke: 'var(--line)' }} strokeWidth="1.2" />
      <circle className="pulse" cx="60" cy="30" r="5" fill="none" style={pulseStyle(3, 'var(--g-dot)')} strokeWidth="2" />
      <circle cx="60" cy="30" r="5" style={{ fill: 'var(--g-dot)' }} />
      <text x="74" y="35" fontSize="14" fontWeight="500" fontFamily={SANS} style={{ fill: 'var(--ink)' }}>
        Live · 148 mg/dL
      </text>

      {/* Forecast bubble */}
      <rect x="290" y="4" width="210" height="56" rx="12" style={{ fill: 'var(--card)', stroke: 'var(--line)' }} strokeWidth="1.2" />
      <path d="M372 59 L380 69 L388 59" style={{ fill: 'var(--card)', stroke: 'var(--line)' }} strokeWidth="1.2" />
      <text x="304" y="24" fontSize="11" fontFamily={MONO} style={{ fill: 'var(--dim)' }}>
        Twin · next 6 h
      </text>
      <path
        d="M304 36 C336 36 360 40 388 46 C410 51 430 54 448 52 C464 50 476 44 488 40"
        fill="none"
        style={{ stroke: 'var(--accent)' }}
        strokeWidth="2"
        strokeDasharray="4 3"
        strokeLinecap="round"
      />
      <circle cx="446" cy="52" r="3.5" style={{ fill: 'var(--risk)' }} />

      <text x="140" y="462" textAnchor="middle" fontSize="13" fontFamily={SANS} style={{ fill: 'var(--muted)' }}>
        Suresh
      </text>
      <text x="380" y="462" textAnchor="middle" fontSize="13" fontFamily={SANS} style={{ fill: 'var(--muted)' }}>
        His twin
      </text>
    </svg>
  );
}
