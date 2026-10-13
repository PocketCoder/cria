import { Pencil, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TableColumnPopup } from './TableColumnPopup';
import type { ColumnKey, VisibleState } from './useTableConfig';

/** Count + edit/save controls + column picker above the table. */
export function TableToolbar({
  countLabel,
  isFetching,
  editMode,
  onToggleEdit,
  onSave,
  visible,
  onToggleColumn,
}: {
  countLabel: string;
  isFetching: boolean;
  editMode: boolean;
  onToggleEdit: () => void;
  onSave: () => void;
  visible: VisibleState;
  onToggleColumn: (key: ColumnKey) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-muted-foreground)]">
      <span>
        {countLabel}
        {isFetching ? <span className="ml-2">syncing…</span> : null}
      </span>
      <div className="flex items-center gap-2">
        {editMode ? (
          <button
            type="button"
            onClick={onSave}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
          >
            <Check className="h-3.5 w-3.5" />
            Save
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleEdit}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
            editMode
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
          )}
          aria-pressed={editMode}
        >
          <Pencil className="h-3.5 w-3.5" />
          {editMode ? 'Editing' : 'Edit'}
        </button>
        <TableColumnPopup visible={visible} onToggle={onToggleColumn} />
      </div>
    </div>
  );
}
