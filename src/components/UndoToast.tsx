import { useEffect, useRef } from 'react';
import { Undo2 } from 'lucide-react';
import { usePendingDeletes, UNDO_WINDOW_MS } from '@/stores/pendingDeletes';

function ProgressBar({ enqueuedAt }: { enqueuedAt: number }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    let rafId: number;
    function tick() {
      const elapsed = Date.now() - enqueuedAt;
      const progress = Math.min(elapsed / UNDO_WINDOW_MS, 1);
      el!.style.width = `${(1 - progress) * 100}%`;
      if (progress < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [enqueuedAt]);

  return (
    <div className="h-0.5 overflow-hidden rounded-full bg-[var(--color-border)]">
      <div
        ref={barRef}
        className="h-full bg-[var(--color-primary)]"
        style={{ width: '100%' }}
      />
    </div>
  );
}

export function UndoToasts() {
  const pending = usePendingDeletes((s) => s.pending);
  const undo = usePendingDeletes((s) => s.undo);
  const entries = Object.values(pending);

  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {entries.map(({ task, enqueuedAt }) => (
        <div
          key={task.localId}
          className="flex flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg"
          role="status"
        >
          <div className="flex items-center gap-3 px-3 py-2 text-xs">
            <span className="max-w-[16rem] truncate text-[var(--color-foreground)]">
              Deleted &ldquo;{task.title}&rdquo;
            </span>
            <button
              onClick={() => undo(task.localId)}
              className="flex shrink-0 items-center gap-1 font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
          </div>
          <ProgressBar enqueuedAt={enqueuedAt} />
        </div>
      ))}
    </div>
  );
}
