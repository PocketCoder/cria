import { useId, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FilterInput } from '@/components/FilterInput';
import { updateView } from '@/db/views';
import {
  parseBucketConfiguration,
  serializeBucketConfiguration,
  validateBucketConfiguration,
  type BucketFilterConfig,
} from '@/lib/bucketConfig';
import type { ProjectView } from '@/domain/view';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import { ViewFilterForm } from './ViewFilterForm';

const BLANK: BucketFilterConfig = { title: '', filter: '', includeNulls: false };

/** Per-view settings inside the view manager: filter, and bucket mode for boards. */
export function ViewSettingsPanel({ view, id }: { view: ProjectView; id?: string }) {
  return (
    <div id={id} className="basis-full space-y-4 border-t border-[var(--color-border)] px-1 py-3">
      <ViewFilterForm view={view} />
      {view.viewKind === 'kanban' && <BucketModeEditor view={view} />}
    </div>
  );
}

function BucketModeEditor({ view }: { view: ProjectView }) {
  const isMobile = useIsMobile();
  const uid = useId();
  const touch = isMobile ? 'min-h-11' : '';
  const [mode, setMode] = useState<'manual' | 'filter'>(
    view.bucketConfigurationMode === 'filter' ? 'filter' : 'manual',
  );
  const [configs, setConfigs] = useState<BucketFilterConfig[]>(() => {
    const parsed = parseBucketConfiguration(view.bucketConfiguration);
    return parsed.length > 0 ? parsed : [{ ...BLANK }];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, next: Partial<BucketFilterConfig>) =>
    setConfigs((cs) => cs.map((c, j) => (j === i ? { ...c, ...next } : c)));

  const save = async () => {
    setError(null);
    if (mode === 'filter') {
      const problem = validateBucketConfiguration(configs);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    try {
      await updateView(view.localId, {
        bucketConfigurationMode: mode,
        ...(mode === 'filter'
          ? { bucketConfiguration: serializeBucketConfiguration(configs, view.bucketConfiguration) }
          : {}),
      });
    } catch (err) {
      console.error('[view-settings] bucket config save failed:', err);
      setError('Couldn’t save the bucket settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <p className="group-label text-[var(--color-muted-foreground)]">Buckets</p>
      <Select value={mode} onValueChange={(v) => setMode(v as 'manual' | 'filter')} disabled={busy}>
        <SelectTrigger aria-label="Bucket mode" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">Manual: drag cards between buckets</SelectItem>
          <SelectItem value="filter">By filter: one bucket per filter</SelectItem>
        </SelectContent>
      </Select>

      {mode === 'filter' && (
        <>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Cards can’t be dragged between filter buckets. Your manual buckets are kept
            and return if you switch back.
          </p>
          <ul className="space-y-2" aria-label="Filter buckets">
            {configs.map((c, i) => (
              <li key={i} className="space-y-1 rounded-md border border-[var(--color-border)] p-2">
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Bucket ${i + 1} title`}
                    value={c.title}
                    onChange={(e) => patch(i, { title: e.target.value })}
                    placeholder="Bucket title"
                    className={cn(
                      'min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]',
                      isMobile ? 'min-h-11 text-base' : 'h-7 text-xs',
                    )}
                  />
                  <button
                    type="button"
                    aria-label={`Remove bucket ${i + 1}`}
                    onClick={() => setConfigs((cs) => cs.filter((_, j) => j !== i))}
                    className={cn(
                      'flex items-center justify-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]',
                      isMobile ? 'h-11 w-11' : 'p-1',
                    )}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <FilterInput
                  value={c.filter}
                  onChange={(filter) => patch(i, { filter })}
                  rows={1}
                  ariaLabel={`Bucket ${i + 1} filter`}
                  placeholder="priority >= 3"
                />
                <div className={cn('flex items-center justify-between', touch)}>
                  <span id={`${uid}-nulls-${i}`} className="text-xs">
                    Include tasks without a value
                  </span>
                  <Switch
                    aria-labelledby={`${uid}-nulls-${i}`}
                    checked={c.includeNulls}
                    onCheckedChange={(includeNulls) => patch(i, { includeNulls })}
                  />
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setConfigs((cs) => [...cs, { ...BLANK }])}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
              isMobile && 'min-h-11 text-sm',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Add bucket
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--color-destructive)]">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className={cn(
            'inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 text-xs font-medium text-[var(--color-primary-foreground)] disabled:opacity-50',
            isMobile ? 'min-h-11 px-4 text-sm' : 'py-1',
          )}
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Save buckets
        </button>
      </div>
    </div>
  );
}
