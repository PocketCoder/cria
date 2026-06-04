import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { COLUMNS, type ColumnKey, type VisibleState } from './useTableConfig';

interface TableColumnPopupProps {
  visible: VisibleState;
  onToggle: (key: ColumnKey) => void;
}

/**
 * "Columns" button → popover with one checkbox per column. Toggling a
 * checkbox shows/hides that column (and persists via the parent's config
 * hook). Mirrors Vikunja's Popup + FancyCheckbox pattern.
 */
export function TableColumnPopup({ visible, onToggle }: TableColumnPopupProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Columns
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <ul>
          {COLUMNS.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--color-accent)]/10">
                <input
                  type="checkbox"
                  checked={visible[c.key]}
                  onChange={() => onToggle(c.key)}
                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
                />
                {c.label}
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
