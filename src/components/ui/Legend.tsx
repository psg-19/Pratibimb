export interface LegendItem {
  label: string;
  color: string;
  /** Line thickness in px. */
  width: number;
  dash?: 'solid' | 'dashed';
}

export function Legend({ items, label = 'Legend' }: { items: readonly LegendItem[]; label?: string }) {
  return (
    <ul className="legend" aria-label={label} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {items.map((l) => (
        <li key={l.label} className="legend__item">
          <span
            className="legend__swatch"
            aria-hidden="true"
            style={{ borderTop: `${l.width}px ${l.dash ?? 'solid'} ${l.color}` }}
          />
          {l.label}
        </li>
      ))}
    </ul>
  );
}
