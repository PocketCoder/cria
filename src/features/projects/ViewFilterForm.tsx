import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { FilterInput } from '@/components/FilterInput';
import { updateView } from '@/db/views';
import { viewFilterParams, type ProjectView } from '@/domain/view';
import { Switch } from '@/components/ui/switch';

/**
 * Edit a view's filter (Vikunja project_views.filter): query plus "include
 * tasks without a value". Saves through the normal view outbox push. Shared by
 * the header's filter popover and the view manager.
 */
export function ViewFilterForm({
  view,
  onSaved,
}: {
  view: ProjectView;
  /** Called after a successful apply or clear. */
  onSaved?: () => void;
}) {
  const current = viewFilterParams(view);
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
      onSaved?.();
    } catch (err) {
      console.error('[view-filter] save failed:', err);
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
    </div>
  );
}
