import { useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { FilterInput } from '@/components/FilterInput';
import { createSavedFilter, updateSavedFilter } from '@/api/savedFilters';
import { useOnline } from '@/hooks/useOnline';
import { Switch } from '@/components/ui/switch';
import type { SavedFilter } from '@/db/savedFilters';

/**
 * Create/edit a Vikunja saved filter. The query is validated live with the
 * same parser that evaluates it; Save is disabled while it doesn't parse.
 */
export function SavedFilterModal({
  existing,
  onClose,
}: {
  /** Present = edit mode. */
  existing?: SavedFilter | null;
  onClose: () => void;
}) {
  const online = useOnline();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [query, setQuery] = useState(existing?.filterQuery ?? '');
  const [includeNulls, setIncludeNulls] = useState(
    existing?.filterIncludeNulls ?? false,
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parseError = useMemo(() => {
    if (!query.trim()) return null;
    try {
      parseFilterQuery(query, new Date());
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [query]);

  const canSave =
    online && !busy && title.trim().length > 0 && query.trim().length > 0 && !parseError;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setSaveError(null);
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || undefined,
        filter: query.trim(),
        filterIncludeNulls: includeNulls,
      };
      if (existing) {
        await updateSavedFilter(existing.serverId, input);
      } else {
        await createSavedFilter(input);
      }
      onClose();
    } catch (err) {
      console.error('[saved-filter] save failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="glass-surface flex w-11/12 max-w-lg flex-col overflow-hidden rounded-lg shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">
            {existing ? 'Edit filter' : 'New filter'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
              Title
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. High priority"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
              Filter query
            </label>
            <FilterInput
              value={query}
              onChange={setQuery}
              rows={3}
              placeholder="done = false && priority >= 3"
            />
            {parseError ? (
              <p className="mt-1 text-xs text-[var(--color-destructive)]">{parseError}</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                Fields: done, priority, percentDone, dueDate, startDate, endDate,
                labels, assignees, project. Combine with && and ||.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
              Description <span className="font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Include tasks without a value</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                e.g. tasks with no due date when filtering by dueDate
              </p>
            </div>
            <Switch checked={includeNulls} onCheckedChange={setIncludeNulls} />
          </div>

          {!online && (
            <p className="text-xs text-[var(--color-warning,#b45309)]">
              You're offline — saving filters needs a connection.
            </p>
          )}
          {saveError && (
            <p className="text-xs text-[var(--color-destructive)]">{saveError}</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {existing ? 'Save' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}
