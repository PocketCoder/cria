import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { priorityColor } from '@/components/ui/priority';
import { updateTask } from '@/db/tasks';
import { playCompletionSound } from '@/utils/sound';
import { useUi } from '@/stores/ui';
import { cn } from '@/lib/cn';
import type { Task } from '@/domain/task';
import { formatShortDate } from './kanbanLogic';

interface CardProps {
  task: Task;
}

export const KanbanCard = memo(function KanbanCard({ task }: CardProps) {
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.localId,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Upstream parity: ⌘/Ctrl+click toggles done instead of opening.
        if (e.metaKey || e.ctrlKey) {
          void updateTask(task.localId, { done: !task.done }).then(() => {
            if (!task.done) playCompletionSound();
          });
          return;
        }
        setSelectedTask(task.localId);
      }}
      className={cn(
        'group mb-2 cursor-grab rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm transition-shadow hover:shadow-sm active:cursor-grabbing',
        task.done && 'opacity-60',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 truncate text-xs">{task.title}</p>
      </div>
      {task.priority > 2 || task.dueDate ? (
        <div className="mt-1 flex items-center gap-2 text-footnote text-[var(--color-muted-foreground)]">
          {task.priority > 2 ? (
            <span style={{ color: priorityColor(task.priority) }}>{'!'.repeat(Math.min(5, task.priority))}</span>
          ) : null}
          {task.dueDate ? (
            <span>{formatShortDate(task.dueDate)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
