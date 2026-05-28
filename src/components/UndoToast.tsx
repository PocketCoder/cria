import { Undo2 } from 'lucide-react';
import { usePendingDeletes } from '@/stores/pendingDeletes';

/**
 * Bottom-right stack of "Deleted X · Undo" toasts, one per task in the
 * pending-delete queue (issue #25). Mounted once at the app shell so it
 * survives project navigation. Auto-dismisses when the queue entry
 * commits (the store's timer) — no per-toast timer here.
 *
 * Sits at `bottom-10` to clear the footer status bar.
 */
export function UndoToasts() {
  const pending = usePendingDeletes((s) => s.pending);
  const undo = usePendingDeletes((s) => s.undo);
  const entries = Object.values(pending);

  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {entries.map((task) => (
        <div
          key={task.localId}
          className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-xs shadow-lg"
          role="status"
        >
          <span className="max-w-[16rem] truncate text-[var(--color-foreground)]">
            Deleted “{task.title}”
          </span>
          <button
            onClick={() => undo(task.localId)}
            className="flex shrink-0 items-center gap-1 font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
