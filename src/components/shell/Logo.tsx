/** Two overlapping circles: solid = the person, dashed = the twin. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <circle cx="11.5" cy="15" r="8.5" style={{ stroke: 'var(--ink)' }} strokeWidth="1.6" />
      <circle cx="18.5" cy="15" r="8.5" style={{ stroke: 'var(--accent)' }} strokeWidth="1.6" strokeDasharray="3 2.6" />
    </svg>
  );
}
