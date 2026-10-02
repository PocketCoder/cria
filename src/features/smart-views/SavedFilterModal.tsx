import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { X, Loader2 } from 'lucide-react';
import { FilterInput } from '@/components/FilterInput';
import { Switch } from '@/components/ui/switch';
import type { SavedFilter } from '@/db/savedFilters';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { useFocusOnMount } from '@/lib/useFocusOnMount';
import { DescribeFilter } from './DescribeFilter';
import type { FilterForm } from './savedFilterLogic';
import { useSavedFilterForm } from './useSavedFilterForm';

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
  const f = useSavedFilterForm(existing, onClose);
  const heading = existing ? 'Edit filter' : 'New filter';

  return (
    <ModalDialog label={heading} onClose={onClose}>
      <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <BackdropDismiss onDismiss={onClose} />
      <div className="relative bg-[var(--color-card)] border border-[var(--color-border)] flex w-11/12 max-w-lg flex-col overflow-hidden rounded-lg shadow-lg">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <SavedFilterFields
          form={f.form}
          setField={f.setField}
          parseError={f.parseError}
          online={f.online}
          saveError={f.saveError}
        />

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
            disabled={!f.canSave}
            onClick={() => void f.save()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {f.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {existing ? 'Save' : 'Create'}
          </button>
        </footer>
      </div>
      </div>
    </ModalDialog>
  );
}

function SavedFilterFields({
  form,
  setField,
  parseError,
  online,
  saveError,
}: {
  form: FilterForm;
  setField: <K extends keyof FilterForm>(key: K, value: FilterForm[K]) => void;
  parseError: string | null;
  online: boolean;
  saveError: string | null;
}) {
  const aiAvailable = useAiAvailable();
  const focusTitle = useFocusOnMount<HTMLInputElement>();
  return (
    <div className="space-y-3 p-4">
      <div>
        <label htmlFor="saved-filter-title" className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
          Title
        </label>
        <input
          id="saved-filter-title"
          type="text"
          ref={focusTitle}
          value={form.title}
          onChange={(e) => setField('title', e.target.value)}
          placeholder="e.g. High priority"
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </div>

      <div>
        <label htmlFor="saved-filter-query" className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
          Filter query
        </label>
        {aiAvailable && <DescribeFilter onQuery={(q) => setField('query', q)} />}
        <FilterInput
          id="saved-filter-query"
          value={form.query}
          onChange={(q) => setField('query', q)}
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
        <label htmlFor="saved-filter-description" className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
          Description <span className="font-normal">(optional)</span>
        </label>
        <input
          id="saved-filter-description"
          type="text"
          value={form.description}
          onChange={(e) => setField('description', e.target.value)}
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
        <Switch checked={form.includeNulls} onCheckedChange={(v) => setField('includeNulls', v)} />
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
  );
}
