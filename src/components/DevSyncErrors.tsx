import { useSyncProgress } from '@/stores/syncProgress';

export function DevSyncErrors() {
  if (import.meta.env.PROD) return null;

  const errors = useSyncProgress((s) => s.errors);
  const clearErrors = useSyncProgress((s) => s.clearErrors);

  if (errors.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-1 rounded-md border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--color-destructive)]">
          Sync errors ({errors.length})
        </span>
        <button
          onClick={clearErrors}
          className="text-xs text-[var(--color-destructive)] underline hover:opacity-80 cursor-pointer"
        >
          Clear
        </button>
      </div>
      {errors.slice(-5).map((e, i) => (
        <div key={i} className="border-t border-[var(--color-destructive)]/20 pt-1">
          <div className="text-[11px] font-medium text-[var(--color-destructive)]">
            {e.step}
          </div>
          <div className="text-[11px] leading-tight text-[var(--color-destructive)] break-words">
            {e.message}
          </div>
        </div>
      ))}
    </div>
  );
}
