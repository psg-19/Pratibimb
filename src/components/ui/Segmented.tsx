import type { CSSProperties, ReactNode } from 'react';

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
  /** Optional colours for this option when selected (defaults: ink background, bg text). */
  activeBg?: string;
  activeFg?: string;
}

interface SegmentedProps<T> {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Track background: page bg (default) or card. */
  track?: 'bg' | 'card';
  /** Button height/padding, matching the design per screen. */
  size?: { minHeight: number; padX: number };
  className?: string;
}

/** Segmented control: a group of toggle buttons with aria-pressed; exactly one is on. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  track = 'bg',
  size = { minHeight: 40, padX: 16 },
  className,
}: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={`seg${track === 'card' ? ' seg--card' : ''}${className ? ` ${className}` : ''}`}>
      {options.map((o) => {
        const style = {
          minHeight: size.minHeight,
          padding: `0 ${size.padX}px`,
          '--seg-on-bg': o.activeBg,
          '--seg-on-fg': o.activeFg,
        } as CSSProperties;
        return (
          <button
            key={String(o.value)}
            type="button"
            className="seg__btn hit"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            style={style}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
