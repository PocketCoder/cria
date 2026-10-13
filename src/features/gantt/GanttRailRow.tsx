import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/cn';
import type { GanttTaskNode } from './buildGanttTaskTree';
import { ROW_HEIGHT } from './constants';

/* ─── Left-rail row (drag-to-reorder handle for top-level tasks) ─── */

export function GanttRailRow({
  node,
  collapsed,
  onToggleCollapse,
  onOpenTask,
  sortable,
}: {
  node: GanttTaskNode;
  collapsed: boolean;
  onToggleCollapse: (taskLocalId: string) => void;
  onOpenTask: (taskLocalId: string) => void;
  sortable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.task.localId, disabled: !sortable });

  const style: React.CSSProperties = {
    height: ROW_HEIGHT,
    paddingLeft: 8 + node.indentLevel * 16,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'flex items-center gap-1 border-b border-[var(--color-border)] pr-2 text-sm',
        node.task.done && 'text-[var(--color-muted-foreground)] line-through',
        sortable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'bg-[var(--color-card)] opacity-60',
      )}
    >
      {node.isParent ? (
        <button
          onClick={() => onToggleCollapse(node.task.localId)}
          className="shrink-0 cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <button
        onClick={() => onOpenTask(node.task.localId)}
        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
        title={node.task.title}
      >
        {node.task.title}
      </button>
    </div>
  );
}

