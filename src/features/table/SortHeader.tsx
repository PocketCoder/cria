import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ColumnDef, SortDir } from './useTableConfig';

interface SortHeaderProps {
  column: ColumnDef;
  /** Current direction for this column, or undefined when not sorted. */
  dir: SortDir | undefined;
  /** 1-based sort priority when multiple columns are sorted (else null). */
  order: number | null;
  onSort: (additive: boolean) => void;
}

/**
 * A `<th>`. Sortable columns render a button that cycles the sort on click
 * (ctrl/meta-click adds a secondary sort); non-sortable columns render a
 * plain label.
 */
export function SortHeader({ column, dir, order, onSort }: SortHeaderProps) {
  if (!column.sortable) {
    return (
      <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">
        {column.label}
      </th>
    );
  }

  return (
    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
      <button
        type="button"
        onClick={(e) => onSort(e.ctrlKey || e.metaKey)}
        className={cn(
          'group inline-flex cursor-pointer items-center gap-1 select-none',
          dir
            ? 'text-[var(--color-foreground)]'
            : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
        )}
        title="Click to sort · ⌘/Ctrl-click to add a secondary sort"
      >
        {column.label}
        {dir === 'asc' ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : dir === 'desc' ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
        )}
        {order !== null ? (
          <span className="text-[9px] tabular-nums text-[var(--color-muted-foreground)]">
            {order}
          </span>
        ) : null}
      </button>
    </th>
  );
}
