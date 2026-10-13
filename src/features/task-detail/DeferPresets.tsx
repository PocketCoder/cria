import { useId } from 'react';
import { DEFER_PRESETS, type DeferPreset } from '@/lib/defer';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';

/** Quick "push the due date" buttons. */
export function DeferPresets({ onDefer }: { onDefer: (preset: DeferPreset) => void }) {
  const labelId = useId();
  const isMobile = useIsMobile();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="mt-2 border-t border-[var(--color-border)] pt-2"
    >
      <p id={labelId} className="px-1 pb-1 text-[11px] text-[var(--color-muted-foreground)]">
        Defer due date
      </p>
      <div className="flex flex-wrap gap-1">
        {DEFER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onDefer(p.id)}
            className={cn(
              'rounded-md border border-[var(--color-border)] px-2 text-xs hover:bg-[var(--color-muted)]',
              isMobile ? 'min-h-11 px-3 text-sm' : 'py-1',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
