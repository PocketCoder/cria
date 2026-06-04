import type { ProjectView } from '@/domain/view';
import { cn } from '@/lib/cn';

interface ViewSwitcherProps {
  views: ProjectView[];
  activeViewLocalId: string | undefined;
  onSelect: (viewLocalId: string) => void;
}

const VIEW_LABELS: Record<string, string> = {
  list: 'List',
  kanban: 'Board',
  table: 'Table',
  gantt: 'Gantt',
};

export function ViewSwitcher({
  views,
  activeViewLocalId,
  onSelect,
}: ViewSwitcherProps) {
  if (views.length <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-[var(--color-muted)]/40 p-0.5">
      {views.map((v) => (
        <button
          key={v.localId}
          onClick={() => onSelect(v.localId)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            v.localId === activeViewLocalId
              ? 'bg-[var(--color-background)] text-[var(--color-foreground)] shadow-sm'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
          )}
        >
          {v.title || VIEW_LABELS[v.viewKind] || v.viewKind}
        </button>
      ))}
    </div>
  );
}
