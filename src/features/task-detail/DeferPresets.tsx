import { DEFER_PRESETS, type DeferPreset } from '@/lib/defer';

/** Quick "push the due date" buttons. */
export function DeferPresets({ onDefer }: { onDefer: (preset: DeferPreset) => void }) {
  return (
    <div className="mt-2 border-t border-[var(--color-border)] pt-2">
      <p className="px-1 pb-1 text-[11px] text-[var(--color-muted-foreground)]">Defer</p>
      <div className="flex flex-wrap gap-1">
        {DEFER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onDefer(p.id)}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
