import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Task } from '@/domain/task';
import type { ColumnDef } from './useTableConfig';
import { Cell, EditField } from './TableCells';
import { EDITABLE_COLUMNS, type DraftFields } from './tableLogic';

interface RowShared {
  task: Task;
  shownColumns: ColumnDef[];
  editMode: boolean;
  // Only this row's own draft, not the whole `drafts` record — so a keystroke
  // in one cell doesn't change props for (and re-render) every other row.
  draft: DraftFields | undefined;
  setDraft: (localId: string, field: keyof DraftFields, value: unknown) => void;
  projectTitle: (id: string) => string;
  currentUserServerId: number | null;
  selectedTaskId: string | null;
  setSelectedTask: (id: string | null) => void;
}

/** The `<td>` cells of one row: read-only, or inputs for editable columns in edit mode. */
function RowCells({
  task,
  shownColumns,
  editMode,
  draft,
  setDraft,
  projectTitle,
  currentUserServerId,
}: Pick<
  RowShared,
  | 'task'
  | 'shownColumns'
  | 'editMode'
  | 'draft'
  | 'setDraft'
  | 'projectTitle'
  | 'currentUserServerId'
>) {
  return (
    <>
      {shownColumns.map((c) => {
        const editable = editMode && EDITABLE_COLUMNS.has(c.key);
        return (
          <td
            key={c.key}
            className="px-3 py-2 align-middle text-[var(--color-foreground)]"
          >
            {editable ? (
              <EditField
                task={task}
                columnKey={c.key}
                draft={draft}
                onChange={(field, value) => setDraft(task.localId, field, value)}
              />
            ) : (
              <Cell
                task={task}
                columnKey={c.key}
                projectTitle={projectTitle}
                currentUserServerId={currentUserServerId}
              />
            )}
          </td>
        );
      })}
    </>
  );
}

export const SortableTableRow = memo(function SortableTableRow(props: RowShared) {
  const { task, editMode, selectedTaskId, setSelectedTask } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.localId,
    disabled: editMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={editMode ? undefined : () => setSelectedTask(task.localId)}
      className={cn(
        'border-b border-[var(--color-border)] transition-colors',
        !editMode && 'cursor-grab hover:bg-[var(--color-accent)]/5 active:cursor-grabbing',
        task.done && 'opacity-60',
        selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
        isDragging && 'opacity-40',
      )}
    >
      <RowCells {...props} />
    </tr>
  );
});

/** Collapsible completed-tasks table below the sortable one. */
export function CompletedRows({
  completed,
  sortedCompleted,
  showCompleted,
  onToggle,
  drafts,
  ...rest
}: Omit<RowShared, 'task' | 'draft'> & {
  completed: number;
  sortedCompleted: Task[];
  showCompleted: boolean;
  onToggle: () => void;
  drafts: Record<string, DraftFields>;
}) {
  const { shownColumns, editMode, selectedTaskId, setSelectedTask } = rest;
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        <tr className="border-b border-[var(--color-border)] bg-[var(--color-accent)]/5">
          <td
            colSpan={shownColumns.length}
            className="px-6 py-2 text-xs text-[var(--color-muted-foreground)]"
          >
            <button
              type="button"
              onClick={onToggle}
              className="flex w-full cursor-pointer items-center gap-2 hover:text-[var(--color-foreground)]"
            >
              {showCompleted ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" />
              )}
              {showCompleted ? 'Hide' : 'Show'} completed ({completed})
            </button>
          </td>
        </tr>
        {showCompleted && sortedCompleted.map((task) => (
          <tr
            key={task.localId}
            tabIndex={editMode ? undefined : 0}
            onClick={editMode ? undefined : () => setSelectedTask(task.localId)}
            onKeyDown={(e) => {
              if (editMode || e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedTask(task.localId);
              }
            }}
            className={cn(
              'border-b border-[var(--color-border)] transition-colors',
              !editMode && 'cursor-pointer hover:bg-[var(--color-accent)]/5',
              task.done && 'opacity-60',
              selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
            )}
          >
            <RowCells task={task} draft={drafts[task.localId]} {...rest} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
