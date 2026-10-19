import type { CSSProperties, ReactNode } from 'react';

interface ChipProps {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Border and background when pressed / not pressed. */
  on: { border: string; bg: string };
  off?: { border: string; bg: string };
  className?: string;
  style?: CSSProperties;
}

/** Toggle chip (aria-pressed). Colours are passed as tokens so each chip keeps its concept hue. */
export function Chip({ pressed, onClick, children, on, off = { border: 'var(--line)', bg: 'transparent' }, className, style }: ChipProps) {
  const c = pressed ? on : off;
  return (
    <button
      type="button"
      className={`chip${className ? ` ${className}` : ''}`}
      aria-pressed={pressed}
      onClick={onClick}
      style={{ '--chip-border': c.border, '--chip-bg': c.bg, ...style } as CSSProperties}
    >
      {children}
    </button>
  );
}
