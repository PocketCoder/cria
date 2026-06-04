import { useState } from 'react';
import { Tags } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useTaskLabels } from '@/queries/taskLabels';
import { useLabels } from '@/queries/labels';
import { toggleTaskLabel, createLabel } from '@/db/labels';
import { LabelChips } from '@/features/tasks/LabelChips';
import { cn } from '@/lib/cn';

/**
 * Editable labels cell for the table's edit mode: a popover to search /
 * toggle existing labels or create a new one. Mirrors the task-detail
 * InlineLabels picker. Label changes apply immediately (like the done
 * checkbox) rather than going through the draft/Save flow — they're discrete
 * relation toggles, not task fields.
 */
export function LabelEditCell({ taskLocalId }: { taskLocalId: string }) {
  const { data: current = [] } = useTaskLabels(taskLocalId);
  const { data: all = [] } = useLabels();
  const [search, setSearch] = useState('');
  const currentIds = new Set(current.map((l) => l.localId));

  const term = search.trim().toLowerCase();
  const filtered = term ? all.filter((l) => l.title.toLowerCase().includes(term)) : all;
  const exact = term ? all.some((l) => l.title.toLowerCase() === term) : false;

  const toggle = (labelLocalId: string) => {
    void toggleTaskLabel(taskLocalId, labelLocalId).catch((e) =>
      console.error('[table] toggle label failed:', e),
    );
  };

  const createAndAdd = async () => {
    const title = search.trim();
    if (!title) return;
    try {
      const label = await createLabel({ title });
      await toggleTaskLabel(taskLocalId, label.localId);
      setSearch('');
    } catch (e) {
      console.error('[table] create label failed:', e);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-[1.5rem] w-full items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-left hover:border-[var(--color-ring)]"
        >
          {current.length > 0 ? (
            <LabelChips labels={current} />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
              <Tags className="h-3 w-3" /> Add
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        <input
          autoFocus
          type="text"
          placeholder="Search or create…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && term && !exact) {
              e.preventDefault();
              void createAndAdd();
            }
          }}
          className="mb-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
        />
        <div className="max-h-48 overflow-y-auto">
          {filtered.length === 0 && !term ? (
            <p className="px-2 py-1 text-[11px] text-[var(--color-muted-foreground)]">
              No labels yet.
            </p>
          ) : null}
          {filtered.map((label) => {
            const active = currentIds.has(label.localId);
            return (
              <button
                key={label.localId}
                type="button"
                onClick={() => toggle(label.localId)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs',
                  active
                    ? 'bg-[var(--color-accent)]/10 font-medium'
                    : 'hover:bg-[var(--color-accent)]/5',
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                  style={label.hexColor ? { background: label.hexColor } : undefined}
                />
                <span className="flex-1 truncate">{label.title}</span>
                {active ? (
                  <span className="text-[10px] text-[var(--color-muted-foreground)]">✓</span>
                ) : null}
              </button>
            );
          })}
          {term && !exact ? (
            <button
              type="button"
              onClick={() => void createAndAdd()}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-[var(--color-primary)] hover:bg-[var(--color-accent)]/5"
            >
              <span className="flex h-2.5 w-2.5 items-center justify-center rounded-full border border-[var(--color-primary)] text-[9px] leading-none">
                +
              </span>
              <span className="flex-1 truncate">Create &ldquo;{search.trim()}&rdquo;</span>
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
