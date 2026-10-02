import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Measures the `index`-th `[data-seg]` child of `ref` so one absolutely
 * positioned indicator can slide between segments. Re-measures on resize.
 */
export function useSegmentIndicator(
  ref: RefObject<HTMLElement | null>,
  index: number,
  /** Changes when the segments' size or count changes, to force a re-measure. */
  layoutKey = '',
): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    const el = root?.querySelectorAll<HTMLElement>('[data-seg]')[index];
    if (!root || !el) {
      setBox(null);
      return;
    }
    const measure = () =>
      setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [ref, index, layoutKey]);
  return box;
}

/** Inline style for the sliding indicator. `moved` gates the transition so
 * the first paint doesn't animate in from the left edge. */
export function indicatorStyle(box: Box, moved: boolean, extra?: string): CSSProperties {
  return {
    left: 0,
    top: box.y,
    width: box.w,
    height: box.h,
    transform: `translateX(${box.x}px)`,
    transition: moved
      ? `transform var(--duration-slide) var(--spring-soft), width var(--duration-slide) var(--spring-soft)${extra ? `, ${extra}` : ''}`
      : 'none',
  };
}
