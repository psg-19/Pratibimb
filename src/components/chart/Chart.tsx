import type { CSSProperties, ReactNode } from 'react';

interface ChartFrameProps {
  width: number;
  height: number;
  /** Text alternative describing what the chart shows. */
  label: string;
  /** SVG marks. */
  children: ReactNode;
  /** HTML overlays (tags, labels) positioned in % of the frame. */
  overlay?: ReactNode;
  className?: string;
}

/** An SVG chart with a matching HTML overlay layer; scales to its container width. */
export function ChartFrame({ width, height, label, children, overlay, className }: ChartFrameProps) {
  return (
    <div className={`chart${className ? ` ${className}` : ''}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        {children}
      </svg>
      {overlay}
    </div>
  );
}

type Stroke = { color: string; width?: number; dash?: string; opacity?: number };

export function VGrid({ xs, height }: { xs: readonly number[]; height: number }) {
  return (
    <g style={{ stroke: 'var(--grid)' }} strokeWidth="1" aria-hidden="true">
      {xs.map((x) => (
        <line key={x} x1={x} x2={x} y1={0} y2={height} />
      ))}
    </g>
  );
}

export function HLine({ y, x1 = 0, x2, color, width = 1, dash }: { y: number; x1?: number; x2: number } & Stroke) {
  return <line x1={x1} x2={x2} y1={y} y2={y} style={{ stroke: color }} strokeWidth={width} strokeDasharray={dash} />;
}

export function VLine({ x, y1 = 0, y2, color, width = 1, opacity }: { x: number; y1?: number; y2: number } & Stroke) {
  return <line x1={x} x2={x} y1={y1} y2={y2} style={{ stroke: color }} strokeWidth={width} strokeOpacity={opacity} />;
}

export function Line({ d, color, width = 2, dash }: { d: string } & Stroke) {
  if (!d) return null;
  return (
    <path
      d={d}
      fill="none"
      style={{ stroke: color }}
      strokeWidth={width}
      strokeDasharray={dash}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export function Area({ d, color, opacity }: { d: string; color: string; opacity: number }) {
  if (!d) return null;
  return <path d={d} style={{ fill: color }} fillOpacity={opacity} />;
}

export function Rect({ x, y, width, height, color, opacity }: { x: number; y: number; width: number; height: number; color: string; opacity: number }) {
  if (width <= 0 || height <= 0) return null;
  return <rect x={x} y={y} width={width} height={height} style={{ fill: color }} fillOpacity={opacity} />;
}

export function Dot({ x, y, r, fill, ring = 'var(--card)', ringWidth }: { x: number; y: number; r: number; fill: string; ring?: string; ringWidth: number }) {
  return <circle cx={x} cy={y} r={r} style={{ fill, stroke: ring }} strokeWidth={ringWidth} />;
}

/** Absolutely positioned HTML label over a chart (keeps text legible at any chart width). */
export function ChartText({ style, children, className = 'chart-text' }: { style: CSSProperties; children: ReactNode; className?: string }) {
  return (
    <span className={className} style={style} aria-hidden="true">
      {children}
    </span>
  );
}
