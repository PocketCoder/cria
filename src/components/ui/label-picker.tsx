import { useState } from 'react';
import { Tags } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useLabels } from '@/queries/labels';
import { LabelChips } from '@/features/tasks/LabelChips';
import type { Label } from '@/domain/label';
import { cn } from '@/lib/cn';

/**
 * Label picker for the task-CREATE flow — works with plain title strings, not
 * a task id, so it can be used before the task exists. Selecting an existing
 * label or typing a new one just toggles its title in `value`; the actual
 * create-if-missing + apply happens at submit via `applyLabelsByTitle`.
 *
 * (The post-create equivalent that mutates immediately is LabelEditCell.)
 */
export function LabelPicker({
  value,
  onChange,
  className,
}: {
  value: string[];
  onChange: (titles: string[]) => void;
  className?: string;
}) {
  const { data: all = [] } = useLabels();
  const [search, setSearch] = useState('');

  const selectedLower = new Set(value.map((t) => t.toLowerCase()));
  const term = search.trim().toLowerCase();
  const filtered = term ? all.filter((l) => l.title.toLowerCase().includes(term)) : all;
  const exists = (t: string) =>
    all.some((l) => l.title.toLowerCase() === t.toLowerCase()) ||
    selectedLower.has(t.toLowerCase());

  const toggle = (title: string) => {
    if (selectedLower.has(title.toLowerCase())) {
      onChange(value.filter((t) => t.toLowerCase() !== title.toLowerCase()));
    } else {
      onChange([...value, title]);
    }
  };

  const addTyped = () => {
    const title = search.trim();
    if (!title) return;
    if (!selectedLower.has(title.toLowerCase())) onChange([...value, title]);
    setSearch('');
  };

  // Render the chosen titles as the app's standard label pills. Existing
  // labels keep their colour; not-yet-created ones get a neutral bordered pill.
  const chips: Label[] = value.map((title) => {
    const existing = all.find((l) => l.title.toLowerCase() === title.toLowerCase());
    return (
      existing ?? {
        localId: `new:${title}`,
        serverId: null,
        title,
        description: null,
        hexColor: null,
        updatedAt: '',
      }
    );
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Labels"
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]',
            className,
          )}
        >
          <Tags className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          {value.length === 0 ? (
            <span className="text-[var(--color-muted-foreground)]">Labels</span>
          ) : (
            <LabelChips labels={chips} />
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
            if (e.key === 'Enter' && term && !exists(search.trim())) {
              e.preventDefault();
              addTyped();
            }
          }}
          className="mb-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
        />
        <div className="max-h-48 overflow-y-auto">
          {filtered.map((label) => {
            const active = selectedLower.has(label.title.toLowerCase());
            return (
              <button
                key={label.localId}
                type="button"
                onClick={() => toggle(label.title)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs',
                  active ? 'bg-[var(--color-accent)]/10 font-medium' : 'hover:bg-[var(--color-accent)]/5',
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                  style={label.hexColor ? { background: label.hexColor } : undefined}
                />
                <span className="flex-1 truncate">{label.title}</span>
                {active ? (
                  <span className="text-footnote text-[var(--color-muted-foreground)]">✓</span>
                ) : null}
              </button>
            );
          })}
          {/* Selected titles that aren't (yet) saved labels — still toggleable. */}
          {value
            .filter((t) => !all.some((l) => l.title.toLowerCase() === t.toLowerCase()))
            .filter((t) => !term || t.toLowerCase().includes(term))
            .map((title) => (
              <button
                key={`new-${title}`}
                type="button"
                onClick={() => toggle(title)}
                className="flex w-full items-center gap-2 rounded bg-[var(--color-accent)]/10 px-2 py-1 text-left text-xs font-medium"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-[var(--color-primary)]" />
                <span className="flex-1 truncate">{title} (new)</span>
                <span className="text-footnote text-[var(--color-muted-foreground)]">✓</span>
              </button>
            ))}
          {term && !exists(search.trim()) ? (
            <button
              type="button"
              onClick={addTyped}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-[var(--color-primary)] hover:bg-[var(--color-accent)]/5"
            >
              <span className="flex h-2.5 w-2.5 items-center justify-center rounded-full border border-[var(--color-primary)] text-micro leading-none">
                +
              </span>
              <span className="flex-1 truncate">Create &ldquo;{search.trim()}&rdquo;</span>
            </button>
          ) : null}
          {filtered.length === 0 && value.length === 0 && !term ? (
            <p className="px-2 py-1 text-caption text-[var(--color-muted-foreground)]">No labels yet.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
