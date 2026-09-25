import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { cn } from '@/lib/cn';

interface Box {
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
  deps: readonly unknown[] = [],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, index, ...deps]);
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

interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** `subtle` (view switcher) or `primary` (purple fill, login tabs). */
  variant?: 'subtle' | 'primary';
  /** Stretch segments to fill the track. */
  fill?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = 'subtle',
  fill = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const primary = variant === 'primary';
  const ref = useRef<HTMLDivElement>(null);
  const index = options.findIndex((o) => o.value === value);
  const box = useSegmentIndicator(ref, index, [options.length, fill, variant]);
  const [moved, setMoved] = useState(false);

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative flex items-stretch overflow-hidden rounded-lg',
        primary
          ? 'border border-[var(--color-border)]'
          : 'gap-0.5 bg-[var(--color-muted)]/40 p-0.5',
        fill && 'w-full',
        className,
      )}
    >
      {box ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute',
            primary
              ? 'rounded-[7px] bg-[var(--color-primary)]'
              : 'rounded-md bg-[var(--color-background)] shadow-sm',
          )}
          style={indicatorStyle(box, moved)}
        />
      ) : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            data-seg=""
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              setMoved(true);
              onChange(o.value);
            }}
            className={cn(
              'relative z-[1] font-medium leading-tight transition-colors duration-200',
              primary ? 'rounded-[7px] px-3 py-2 text-sm' : 'rounded-md px-2.5 py-1 text-xs',
              fill && 'flex-1',
              on
                ? primary
                  ? 'text-[var(--color-primary-foreground)]'
                  : 'text-[var(--color-foreground)]'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
