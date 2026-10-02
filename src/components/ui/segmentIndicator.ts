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
  /** Changes when the segments' size, count or labels change, to force a re-measure. */
  layoutKey = '',
): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) {
      setBox(null);
      return;
    }
    // Re-resolve the segment on every measure: options can be swapped for new
    // buttons at the same index, and a cached element would be detached by
    // then (offsetWidth 0), collapsing the indicator on the next resize.
    const measure = () => {
      const el = root.querySelectorAll<HTMLElement>('[data-seg]')[index];
      if (!el) {
        setBox(null);
        return;
      }
      const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      setBox((prev) =>
        prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
          ? prev
          : next,
      );
    };
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
