import { useSyncProgress } from '@/stores/syncProgress';

export function DevSyncErrors() {
  if (import.meta.env.PROD) return null;

  const errors = useSyncProgress((s) => s.errors);
  const clearErrors = useSyncProgress((s) => s.clearErrors);

  if (errors.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-3 shadow-lg dark:border-red-800 dark:bg-red-950">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-red-700 dark:text-red-400">
          Sync errors ({errors.length})
        </span>
        <button
          onClick={clearErrors}
          className="text-xs text-red-500 underline hover:text-red-700 cursor-pointer"
        >
          Clear
        </button>
      </div>
      {errors.slice(-5).map((e, i) => (
        <div key={i} className="border-t border-red-200 pt-1 dark:border-red-800">
          <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
            {e.step}
          </div>
          <div className="text-[11px] leading-tight text-red-700 dark:text-red-300 break-words">
            {e.message}
          </div>
        </div>
      ))}
    </div>
  );
}
