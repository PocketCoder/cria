import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link2,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
  Loader2,
} from 'lucide-react';
import {
  listRelationsForTask,
  addRelation,
  removeRelation,
  type TaskRelation,
} from '@/db/relations';
import { searchTasks, type TaskWithProject } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { useUi } from '@/stores/ui';
import {
  TASK_RELATION_PICKABLE_KINDS,
  type TaskRelationKind,
} from '@/domain/task';

/**
 * The task detail card's relations panel. Mirrors Vikunja-web's
 * "Related tasks" surface (frontend/src/components/tasks/partials/
 * RelatedTasks.vue) — same kinds, same grouping, same click-to-navigate
 * UX. One section per RelationKind that has at least one entry; an
 * always-visible Add row lets the user pick a kind and search a peer
 * task via FTS5.
 *
 * Server creates the inverse on the other task automatically (subtask
 * ↔ parenttask, blocking ↔ blocked, etc.), so we only push one side
 * and rely on the next pull to mirror the inverse row on the peer's
 * relation map.
 */
export function RelatedTasks({
  taskLocalId,
  taskServerId,
}: {
  taskLocalId: string;
  taskServerId: number | null;
}) {
  const qc = useQueryClient();
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const [adding, setAdding] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['relations'] });
      }),
    [qc],
  );

  const { data: relations = [] } = useQuery<TaskRelation[]>({
    queryKey: ['relations', taskLocalId],
    staleTime: 30_000,
    queryFn: () => listRelationsForTask(taskLocalId),
  });

  // Group relations by kind for rendering. Sorted by KIND_ORDER below
  // so sections appear in a stable, human-readable order regardless of
  // insertion sequence.
  const grouped = useMemo(() => {
    const m = new Map<TaskRelationKind, TaskRelation[]>();
    for (const r of relations) {
      const arr = m.get(r.kind) ?? [];
      arr.push(r);
      m.set(r.kind, arr);
    }
    return [...m.entries()].sort(
      ([a], [b]) => (KIND_ORDER[a] ?? 99) - (KIND_ORDER[b] ?? 99),
    );
  }, [relations]);

  const disabled = taskServerId == null;

  const handleRemove = async (r: TaskRelation) => {
    setOpError(null);
    try {
      await removeRelation(taskLocalId, r.otherTaskLocalId, r.otherTaskServerId, r.kind);
      qc.setQueryData(['relations', taskLocalId], await listRelationsForTask(taskLocalId));
      if (r.otherTaskLocalId) {
        qc.setQueryData(['relations', r.otherTaskLocalId], await listRelationsForTask(r.otherTaskLocalId));
      }
    } catch (err) {
      console.error('[relations] remove failed:', err);
      setOpError(String(err instanceof Error ? err.message : err));
    }
  };

  return (
    <section className="mb-4">
      <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <Link2 className="h-3 w-3" />
        Related tasks
        {relations.length > 0 ? (
          <span className="font-normal">{relations.length}</span>
        ) : null}
      </h3>

      {grouped.length > 0 ? (
        <div className="mb-1 space-y-1.5">
          {grouped.map(([kind, items]) => (
            <div key={kind}>
              <div className="mb-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)]">
                {KIND_LABEL[kind]}
              </div>
              <ul className="space-y-1">
                {items.map((r) => (
                  <li
                    key={`${kind}-${r.otherTaskLocalId ?? r.otherTaskServerId}`}
                    className="group flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs"
                  >
                    {r.otherTaskDone ? (
                      <CheckSquare className="h-3.5 w-3.5 shrink-0 text-[var(--color-success,var(--color-primary))]" />
                    ) : (
                      <Square className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        // Click navigates into the peer's detail. If
                        // the peer hasn't synced locally yet (carried
                        // by server id only) we can't select it — but
                        // the row title still tells the user where it
                        // points.
                        if (r.otherTaskLocalId) {
                          setSelectedTask(r.otherTaskLocalId);
                        }
                      }}
                      className={
                        'min-w-0 flex-1 truncate text-left ' +
                        (r.otherTaskDone
                          ? 'line-through text-[var(--color-muted-foreground)]'
                          : '') +
                        (r.otherTaskLocalId
                          ? ' hover:underline cursor-pointer'
                          : ' cursor-default')
                      }
                      title={r.otherTaskTitle}
                    >
                      {r.otherTaskTitle}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove(r)}
                      disabled={disabled}
                      aria-label="Remove relation"
                      className="shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-warning)] group-hover:opacity-100 disabled:opacity-40 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {opError ? (
        <div className="mb-1 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2 py-1 text-xs text-[var(--color-foreground)]">
          {opError}
          <button
            type="button"
            onClick={() => setOpError(null)}
            className="ml-2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            dismiss
          </button>
        </div>
      ) : null}

      {adding ? (
        <AddRelationRow
          taskLocalId={taskLocalId}
          disabled={disabled}
          onCancel={() => setAdding(false)}
          onError={(msg) => setOpError(msg)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={disabled}
          title={
            disabled
              ? 'Save the task first — relations need a server id'
              : 'Add a related task'
          }
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-40 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Add relation
        </button>
      )}
    </section>
  );
}

/**
 * The add-relation row: kind picker + task picker (FTS5 over all
 * non-deleted tasks). Self-closing on success; the parent decides
 * whether to keep it open for batch-add (currently it doesn't).
 */
function AddRelationRow({
  taskLocalId,
  disabled,
  onCancel,
  onError,
}: {
  taskLocalId: string;
  disabled: boolean;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<TaskRelationKind>('subtask');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskWithProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the FTS5 query so each keystroke doesn't hit SQLite. 120ms
  // matches the cmd palette / search input cadence elsewhere.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await searchTasks({ text: query });
        // Don't offer the current task or anything already related to
        // it; let the parent's group sections show the duplicates if
        // the user really wants to re-pick a kind. Active vs. completed
        // are split at render time.
        setResults(found.filter((t) => t.localId !== taskLocalId));
        setShowCompleted(false);
      } catch (err) {
        console.warn('[relations] search failed:', err);
        setResults([]);
      }
    }, 120);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, taskLocalId]);

  const handlePick = async (other: TaskWithProject) => {
    setBusy(true);
    try {
      await addRelation(taskLocalId, other.localId, kind);
      qc.setQueryData(['relations', taskLocalId], await listRelationsForTask(taskLocalId));
      qc.setQueryData(['relations', other.localId], await listRelationsForTask(other.localId));
      onCancel();
    } catch (err) {
      console.error('[relations] add failed:', err);
      onError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  // Completed tasks are demoted: they rarely make sense as a new relation
  // target, so they're hidden behind a toggle when there are matches.
  const active = results.filter((t) => !t.done).slice(0, 8);
  const completed = results.filter((t) => t.done).slice(0, 8);

  const renderItem = (t: TaskWithProject) => (
    <li key={t.localId}>
      <button
        type="button"
        onClick={() => void handlePick(t)}
        disabled={busy}
        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-[var(--color-muted)] disabled:opacity-50 cursor-pointer"
      >
        {t.done ? (
          <CheckSquare className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        ) : (
          <Square className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        )}
        <span
          className={
            'min-w-0 flex-1 truncate ' +
            (t.done ? 'line-through text-[var(--color-muted-foreground)]' : '')
          }
        >
          {t.title}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
          {t.projectTitle}
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TaskRelationKind)}
            disabled={disabled || busy}
            className="appearance-none rounded border border-[var(--color-border)] bg-[var(--color-input)] py-1 pl-1.5 pr-5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          >
            {TASK_RELATION_PICKABLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        </div>
        <input
          type="text"
          autoFocus
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          disabled={disabled || busy}
          className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-muted-foreground)]" />
        ) : (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {active.length > 0 ? (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">{active.map(renderItem)}</ul>
      ) : null}

      {completed.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            {showCompleted ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            {showCompleted ? 'Hide' : 'Show'} completed ({completed.length})
          </button>
          {showCompleted ? (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {completed.map(renderItem)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {query.trim() && active.length === 0 && completed.length === 0 ? (
        <div className="px-1 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">
          No matches
        </div>
      ) : null}
    </div>
  );
}

// Order sections from "the user is most likely to use this" to least.
const KIND_ORDER: Record<TaskRelationKind, number> = {
  subtask: 0,
  parenttask: 1,
  related: 2,
  blocking: 3,
  blocked: 4,
  duplicates: 5,
  duplicateof: 6,
  precedes: 7,
  follows: 8,
  copiedfrom: 9,
  copiedto: 10,
};

const KIND_LABEL: Record<TaskRelationKind, string> = {
  subtask: 'Subtasks',
  parenttask: 'Parent task',
  related: 'Related',
  blocking: 'Blocking',
  blocked: 'Blocked by',
  duplicates: 'Duplicates',
  duplicateof: 'Duplicate of',
  precedes: 'Precedes',
  follows: 'Follows',
  copiedfrom: 'Copied from',
  copiedto: 'Copied to',
};
