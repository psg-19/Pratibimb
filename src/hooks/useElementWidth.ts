import { useEffect, useRef, useState } from 'react';

/** Tracks an element's content width with ResizeObserver. Width is null until first measured. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

/**
 * Charts keep the design's viewBox on wide containers and switch to a narrower viewBox below
 * `breakpoint` px, so strokes, dots and the plot height stay legible on phones.
 */
export function useChartSize<T extends HTMLElement>(wide: { w: number; h: number }, compact: { w: number; h: number }, breakpoint = 520) {
  const [ref, width] = useElementWidth<T>();
  const isCompact = width != null && width < breakpoint;
  return { ref, compact: isCompact, width, ...(isCompact ? compact : wide) };
}
