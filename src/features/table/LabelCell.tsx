import { useTaskLabels } from '@/queries/taskLabels';
import { LabelChips } from '@/features/tasks/LabelChips';

/**
 * Table cell rendering a task's labels as compact chips. Reuses the same
 * per-task label query the list view uses (cheap against local SQLite).
 */
export function LabelCell({ taskLocalId }: { taskLocalId: string }) {
  const { data: labels = [] } = useTaskLabels(taskLocalId);
  if (labels.length === 0) {
    return <span className="text-[var(--color-muted-foreground)]">—</span>;
  }
  return <LabelChips labels={labels} />;
}
