import { SlidersHorizontal, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useLabels } from '@/queries/labels';
import { cn } from '@/lib/cn';
import {
  type BoardFilter,
  EMPTY_BOARD_FILTER,
  isBoardFilterActive,
} from './boardFilter';

interface KanbanFilterPopupProps {
  filter: BoardFilter;
  onChange: (next: BoardFilter) => void;
}

/**
 * Board filter: a popover with explicit controls (text / min priority /
 * labels / show-done). Filtering is applied client-side by the board.
 */
export function KanbanFilterPopup({ filter, onChange }: KanbanFilterPopupProps) {
  const { data: labels = [] } = useLabels();
  const active = isBoardFilterActive(filter);

  const toggleLabel = (id: string) => {
    const has = filter.labelLocalIds.includes(id);
    onChange({
      ...filter,
      labelLocalIds: has
        ? filter.labelLocalIds.filter((x) => x !== id)
        : [...filter.labelLocalIds, id],
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
            active
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filter
          {active ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex flex-col gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-[var(--color-muted-foreground)]">Search</span>
            <input
              type="text"
              value={filter.text}
              onChange={(e) => onChange({ ...filter, text: e.target.value })}
              placeholder="Title or description…"
              className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
            />
          </label>

          <label className="flex items-center justify-between gap-2">
            <span className="text-[var(--color-muted-foreground)]">Min priority</span>
            <select
              value={String(filter.minPriority)}
              onChange={(e) => onChange({ ...filter, minPriority: Number(e.target.value) })}
              className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
            >
              <option value="0">Any</option>
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {'!'.repeat(p)}
                </option>
              ))}
            </select>
          </label>

          {labels.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-[var(--color-muted-foreground)]">Labels</span>
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                {labels.map((l) => {
                  const on = filter.labelLocalIds.includes(l.localId);
                  return (
                    <button
                      key={l.localId}
                      type="button"
                      onClick={() => toggleLabel(l.localId)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px]',
                        on
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-foreground)]'
                          : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                      )}
                    >
                      {l.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={filter.showDone}
              onChange={(e) => onChange({ ...filter, showDone: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
            />
            Show done tasks
          </label>

          {active ? (
            <button
              type="button"
              onClick={() => onChange(EMPTY_BOARD_FILTER)}
              className="inline-flex cursor-pointer items-center gap-1 self-start text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-3 w-3" /> Clear filters
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
