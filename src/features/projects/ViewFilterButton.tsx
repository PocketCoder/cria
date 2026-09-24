import { useMemo, useState } from 'react';
import { ListFilter, Loader2 } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { FilterInput } from '@/components/FilterInput';
import { updateView } from '@/db/views';
import { viewFilterParams, type ProjectView } from '@/domain/view';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';

/**
 * Per-view filter editor (Vikunja project_views.filter). The funnel icon is
 * highlighted while the view has an active filter; saving goes through the
 * normal view outbox push.
 */
export function ViewFilterButton({ view }: { view: ProjectView }) {
  const current = viewFilterParams(view);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(current?.filter ?? '');
  const [includeNulls, setIncludeNulls] = useState(current?.includeNulls ?? false);
  const [busy, setBusy] = useState(false);

  const parseError = useMemo(() => {
    if (!query.trim()) return null;
    try {
      parseFilterQuery(query, new Date());
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [query]);

  const save = async (clear = false) => {
    setBusy(true);
    try {
      await updateView(view.localId, {
        filter: clear || !query.trim()
          ? null
          : JSON.stringify({ filter: query.trim(), filter_include_nulls: includeNulls }),
      });
      if (clear) {
        setQuery('');
        setIncludeNulls(false);
      }
      setOpen(false);
    } catch (err) {
      console.error('[view-filter] save failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter this view"
          className={cn(
            'rounded-md p-1.5 hover:bg-[var(--color-muted)]',
            current
              ? 'text-[var(--color-primary)]'
              : 'text-[var(--color-muted-foreground)]',
          )}
        >
          <ListFilter className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          View filter
        </p>
        <FilterInput
          value={query}
          onChange={setQuery}
          rows={2}
          autoFocus
          placeholder="done = false && priority >= 3"
        />
        {parseError && (
          <p className="mt-1 text-xs text-[var(--color-destructive)]">{parseError}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs">Include tasks without a value</span>
          <Switch checked={includeNulls} onCheckedChange={setIncludeNulls} />
        </div>
        <div className="mt-3 flex justify-between">
          <button
            type="button"
            disabled={busy || !current}
            onClick={() => void save(true)}
            className="rounded-md px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={busy || !!parseError || !query.trim()}
            onClick={() => void save()}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Apply
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
