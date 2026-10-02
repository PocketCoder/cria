import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { indicatorStyle, useSegmentIndicator } from './segmentIndicator';

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
  const box = useSegmentIndicator(ref, index, `${options.length}:${fill}:${variant}`);
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
