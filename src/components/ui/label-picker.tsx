import { useState } from 'react';
import { Check, Plus, Tags } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  pickerChipClass,
  pickerRowClass,
  type PickerOpenProps,
} from '@/components/ui/popover';
import { useLabels } from '@/queries/labels';
import { LabelChips } from '@/features/tasks/LabelChips';
import type { Label } from '@/domain/label';
import { cn } from '@/lib/cn';
import { useFocusOnMount } from '@/lib/useFocusOnMount';

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
  open,
  onOpenChange,
}: PickerOpenProps & {
  value: string[];
  onChange: (titles: string[]) => void;
  className?: string;
}) {
  const { data: all = [] } = useLabels();
  const [search, setSearch] = useState('');
  const focusOnMount = useFocusOnMount<HTMLInputElement>();

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
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Labels"
          className={cn(pickerChipClass, className)}
        >
          <Tags className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          {value.length === 0 ? (
            <span className="text-[var(--color-muted-foreground)]">Labels</span>
          ) : (
            <LabelChips labels={chips} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1">
        <input
          aria-label="Search or create label"
          ref={focusOnMount}
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
          className="mb-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-[13.5px] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
        />
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {filtered.map((label) => {
            const active = selectedLower.has(label.title.toLowerCase());
            return (
              <button
                key={label.localId}
                type="button"
                onClick={() => toggle(label.title)}
                className={cn(pickerRowClass, active && 'bg-[var(--color-muted)]')}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: label.hexColor || 'var(--color-muted-foreground)' }}
                />
                <span className="min-w-0 flex-1 truncate">{label.title}</span>
                {active ? <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" /> : null}
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
                className={cn(pickerRowClass, 'bg-[var(--color-muted)]')}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-dashed border-[var(--color-primary)]" />
                <span className="min-w-0 flex-1 truncate">{title} (new)</span>
                <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />
              </button>
            ))}
          {term && !exists(search.trim()) ? (
            <button
              type="button"
              onClick={addTyped}
              className={cn(pickerRowClass, 'text-[var(--color-primary)]')}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Create &ldquo;{search.trim()}&rdquo;</span>
            </button>
          ) : null}
          {filtered.length === 0 && value.length === 0 && !term ? (
            <p className="px-2 py-1.5 text-xs text-[var(--color-muted-foreground)]">No labels yet.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
