import { useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { FilterInput } from '@/components/FilterInput';
import { updateView } from '@/db/views';
import { viewFilterParams, type ProjectView } from '@/domain/view';
import { Switch } from '@/components/ui/switch';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';

/**
 * Edit a view's filter (Vikunja project_views.filter): query plus "include
 * tasks without a value". Saves through the normal view outbox push. Shared by
 * the header's filter popover and the view manager.
 */
export function ViewFilterForm({
  view,
  onSaved,
  autoFocus = false,
}: {
  view: ProjectView;
  /** Focus the query on mount (fine in a popover; not in an expanding panel, where it would raise the iOS keyboard). */
  autoFocus?: boolean;
  /** Called after a successful apply or clear. */
  onSaved?: () => void;
}) {
  const current = viewFilterParams(view);
  const [query, setQuery] = useState(current?.filter ?? '');
  const [includeNulls, setIncludeNulls] = useState(current?.includeNulls ?? false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const labelId = useId();

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
    setSaveError(null);
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
      onSaved?.();
    } catch (err) {
      console.error('[view-filter] save failed:', err);
      setSaveError('Couldn’t save the filter.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-2 group-label text-[var(--color-muted-foreground)]">
        View filter
      </p>
      <FilterInput
        value={query}
        onChange={setQuery}
        rows={2}
        autoFocus={autoFocus}
        ariaLabel="View filter query"
        placeholder="done = false && priority >= 3"
      />
      {parseError && (
        <p className="mt-1 text-xs text-[var(--color-destructive)]">{parseError}</p>
      )}
      {saveError && (
        <p role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">
          {saveError}
        </p>
      )}
      <div className={cn('mt-2 flex items-center justify-between', isMobile && 'min-h-11')}>
        <span id={`${labelId}-nulls`} className="text-xs">
          Include tasks without a value
        </span>
        <Switch
          aria-labelledby={`${labelId}-nulls`}
          checked={includeNulls}
          onCheckedChange={setIncludeNulls}
        />
      </div>
      <div className="mt-3 flex justify-between">
        <button
          type="button"
          disabled={busy || !current}
          onClick={() => void save(true)}
          className={cn(
            'rounded-md px-2 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50',
            isMobile ? 'min-h-11 px-3 text-sm' : 'py-1',
          )}
        >
          Clear
        </button>
        <button
          type="button"
          disabled={busy || !!parseError || !query.trim()}
          onClick={() => void save()}
          className={cn(
            'inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 text-xs font-medium text-[var(--color-primary-foreground)] disabled:opacity-50',
            isMobile ? 'min-h-11 px-4 text-sm' : 'py-1',
          )}
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Apply
        </button>
      </div>
    </div>
  );
}
