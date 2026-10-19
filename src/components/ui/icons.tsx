import type { CSSProperties, ReactNode } from 'react';
import type { SourceId } from '../../model/types';

type IconProps = { size?: number; style?: CSSProperties; className?: string };

export function ArrowRight({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 9h11M10 4.5L14.5 9 10 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ size = 16 }: IconProps) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2a6 6 0 1 1-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Warning({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M11 3l9 16H2z" style={{ stroke: 'var(--risk)' }} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M11 9v4.5M11 16.2v.3" style={{ stroke: 'var(--risk)' }} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CheckCircle({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="9" style={{ stroke: 'var(--g-ink)' }} strokeWidth="1.7" />
      <path d="M7 11.3l2.8 2.8L15.2 8.6" style={{ stroke: 'var(--g-ink)' }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendDown({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 5l9 8M13 7.5V13H7.5" style={{ stroke: 'var(--accent)' }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Filled check-in-a-dot for learned parameters; colour comes from the caller. */
export function CheckDot({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="8" style={{ fill: color }} />
      <path d="M5.2 9.3l2.4 2.4 5-5" style={{ stroke: 'var(--card)' }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Lock() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="4" y="8" width="10" height="7" rx="1.6" style={{ stroke: 'var(--faint)' }} strokeWidth="1.5" />
      <path d="M6.5 8V6.2a2.5 2.5 0 0 1 5 0V8" style={{ stroke: 'var(--faint)' }} strokeWidth="1.5" />
    </svg>
  );
}

export function PlateSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.6" style={{ stroke: 'var(--o-ink)' }} strokeWidth="1.3" />
      <circle cx="6" cy="6" r="2" style={{ stroke: 'var(--o-ink)' }} strokeWidth="1.1" />
    </svg>
  );
}

/* ---------- Data-source glyphs (24 px grid, stroked in the source's hue ink) ---------- */

const GLYPH_PATHS: Record<SourceId, ReactNode> = {
  cgm: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.5 12h2.2l1.6-3.2 3.2 6.4 1.6-3.2h2.4" />
    </>
  ),
  watch: (
    <>
      <rect x="6.5" y="6" width="11" height="12" rx="3.2" />
      <path d="M9 6V2.8h6V6M9 18v3.2h6V18M12 9.5v3l1.8 1.2" />
    </>
  ),
  abha: (
    <>
      <path d="M6.5 2.8h7.5l4 4v14.4H6.5z" />
      <path d="M14 2.8v4h4M9.5 12h5.5M9.5 16h5.5" />
    </>
  ),
  meals: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  bp: (
    <>
      <path d="M12 20.5s-7.5-4.6-7.5-10.4A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z" />
      <path d="M8 12.5h2l1.2-2.2 2 4 1-1.8h2" />
    </>
  ),
};

/** Icon for a data source; colour comes from the enclosing .hue-* scope. */
export function SourceGlyph({ id }: { id: SourceId }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      style={{ stroke: 'var(--h-ink)' }}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPH_PATHS[id]}
    </svg>
  );
}

/* ---------- Trust-card glyphs (32 px) ---------- */

export function ExplainGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="8.5" style={{ stroke: 'var(--y-ink)' }} strokeWidth="1.8" />
      <path d="M20.5 20.5L27 27" style={{ stroke: 'var(--y-ink)' }} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 15.5l2.5 2.5L18 11" style={{ stroke: 'var(--y-ink)' }} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ConsentGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="5" y="9" width="22" height="14" rx="7" style={{ stroke: 'var(--g-ink)' }} strokeWidth="1.8" />
      <circle cx="20" cy="16" r="4" style={{ fill: 'var(--g-ink)' }} />
    </svg>
  );
}

export function ClinicianGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="11" r="5" style={{ stroke: 'var(--pk-ink)' }} strokeWidth="1.8" />
      <path d="M6.5 27c1.2-5 5-7.5 9.5-7.5s8.3 2.5 9.5 7.5" style={{ stroke: 'var(--pk-ink)' }} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
