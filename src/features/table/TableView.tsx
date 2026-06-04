import { useMemo, useState } from 'react';
import { useProjectTasks } from '@/queries/tasks';
import { useProjects } from '@/queries/projects';
import { useCurrentUser } from '@/queries/user';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useUi } from '@/stores/ui';
import { updateTask } from '@/db/tasks';
import { playCompletionSound } from '@/utils/sound';
import { DatePicker } from '@/components/DatePicker';
import { cn } from '@/lib/cn';
import type { Project } from '@/domain/project';
import type { Task } from '@/domain/task';
import {
  useTableConfig,
  sortTasks,
  type ColumnKey,
} from './useTableConfig';
import { SortHeader } from './SortHeader';
import { TableColumnPopup } from './TableColumnPopup';
import { DateCell } from './DateCell';
import { LabelCell } from './LabelCell';
import { AssigneeCell } from './AssigneeCell';

interface TableViewProps {
  project: Project;
}

/**
 * Dense, sortable, multi-column table view. Reads the same
 * `useProjectTasks` data as the list view; column visibility + sort are
 * driven by `useTableConfig` (global localStorage). Row click opens the
 * task detail card, like the list view.
 */
export function TableView({ project }: TableViewProps) {
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project);
  const { data: allProjects = [] } = useProjects();
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const { columns, visible, sortBy, toggleColumn, onSort } = useTableConfig();
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const selectedTaskId = useUi((s) => s.selectedTaskLocalId);
  const { data: currentUser } = useCurrentUser();

  // Inline editing: double-click an editable cell. One cell at a time.
  const [editing, setEditing] = useState<{ taskLocalId: string; column: ColumnKey } | null>(null);
  const stopEditing = () => setEditing(null);

  const projectTitle = useMemo(() => {
    const map = new Map(allProjects.map((p) => [p.localId, p.title]));
    return (id: string) => map.get(id) ?? '';
  }, [allProjects]);

  const visibleTasks = useMemo(
    () => tasks.filter((t) => !pendingDeletes[t.localId]),
    [tasks, pendingDeletes],
  );

  const sorted = useMemo(
    () => sortTasks(visibleTasks, sortBy, { projectTitle, visible }),
    [visibleTasks, sortBy, projectTitle, visible],
  );

  const shownColumns = columns.filter((c) => visible[c.key]);

  // 1-based sort priority per column, only meaningful with >1 active key.
  const sortOrder = useMemo(() => {
    const active = (Object.keys(sortBy) as ColumnKey[]).filter(
      (k) => visible[k],
    );
    const m = new Map<ColumnKey, number>();
    if (active.length > 1) active.forEach((k, i) => m.set(k, i + 1));
    return m;
  }, [sortBy, visible]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-muted-foreground)]">
        <span>
          {visibleTasks.length === 0
            ? isLoading
              ? 'Loading…'
              : 'No tasks'
            : `${visibleTasks.length} task${visibleTasks.length === 1 ? '' : 's'}`}
          {isFetching ? <span className="ml-2">syncing…</span> : null}
        </span>
        <TableColumnPopup visible={visible} onToggle={toggleColumn} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-background)] text-xs">
            <tr className="border-b border-[var(--color-border)]">
              {shownColumns.map((c) => (
                <SortHeader
                  key={c.key}
                  column={c}
                  dir={sortBy[c.key]}
                  order={sortOrder.get(c.key) ?? null}
                  onSort={(additive) => onSort(c.key, additive)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((task) => (
              <tr
                key={task.localId}
                onClick={() => setSelectedTask(task.localId)}
                className={cn(
                  'cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)]/5',
                  task.done && 'opacity-60',
                  selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
                )}
              >
                {shownColumns.map((c) => {
                  const editable = EDITABLE_COLUMNS.has(c.key);
                  const isEditing =
                    editing?.taskLocalId === task.localId && editing.column === c.key;
                  return (
                    <td
                      key={c.key}
                      onDoubleClick={
                        editable && !isEditing
                          ? (e) => {
                              e.stopPropagation();
                              setEditing({ taskLocalId: task.localId, column: c.key });
                            }
                          : undefined
                      }
                      className={cn(
                        'px-3 py-2 align-middle text-[var(--color-foreground)]',
                        editable && 'cursor-text',
                      )}
                    >
                      {isEditing ? (
                        <CellEditor task={task} columnKey={c.key} onDone={stopEditing} />
                      ) : (
                        <Cell
                          task={task}
                          columnKey={c.key}
                          projectTitle={projectTitle}
                          currentUserServerId={currentUser?.serverId ?? null}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {sorted.length === 0 && !isLoading ? (
          <p className="px-6 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
            No tasks
          </p>
        ) : null}
      </div>

      {isError ? (
        <p className="border-t border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-warning)]">
          Couldn't refresh{error instanceof Error ? `: ${error.message}` : ''}.
        </p>
      ) : null}
    </section>
  );
}

/* ───────────────────────── cells ───────────────────────── */

/** Columns the user can edit inline (double-click). */
const EDITABLE_COLUMNS = new Set<ColumnKey>([
  'title',
  'priority',
  'dueDate',
  'startDate',
  'endDate',
]);

function Cell({
  task,
  columnKey,
  projectTitle,
  currentUserServerId,
}: {
  task: Task;
  columnKey: ColumnKey;
  projectTitle: (id: string) => string;
  currentUserServerId: number | null;
}) {
  switch (columnKey) {
    case 'index':
      return (
        <span className="tabular-nums text-[var(--color-muted-foreground)]">
          {task.identifier || (task.serverId != null ? `#${task.serverId}` : '—')}
        </span>
      );
    case 'done':
      return <DoneCheckbox task={task} />;
    case 'project':
      return <span className="truncate">{projectTitle(task.projectLocalId) || '—'}</span>;
    case 'title':
      return (
        <span
          className={cn(
            'block max-w-[28rem] truncate',
            task.done && 'line-through text-[var(--color-muted-foreground)]',
          )}
          title={task.title}
        >
          {task.title}
        </span>
      );
    case 'priority':
      return task.priority > 0 ? (
        <span aria-label={`Priority ${task.priority}`}>
          {'!'.repeat(Math.min(5, task.priority))}
        </span>
      ) : (
        <span className="text-[var(--color-muted-foreground)]">—</span>
      );
    case 'labels':
      return <LabelCell taskLocalId={task.localId} />;
    case 'assignees':
      return <AssigneeCell taskLocalId={task.localId} />;
    case 'dueDate':
      return <DateCell value={task.dueDate} />;
    case 'startDate':
      return <DateCell value={task.startDate} />;
    case 'endDate':
      return <DateCell value={task.endDate} />;
    case 'doneAt':
      return <DateCell value={task.doneAt} />;
    case 'updated':
      return <DateCell value={task.updatedAt} />;
    case 'created':
      return <DateCell value={task.createdAt} />;
    case 'createdBy':
      return (
        <span className="text-[var(--color-muted-foreground)]">
          {task.createdById == null
            ? '—'
            : task.createdById === currentUserServerId
              ? 'You'
              : `#${task.createdById}`}
        </span>
      );
    case 'percentDone':
      return <PercentCell value={task.percentDone} />;
    default:
      return null;
  }
}

/* ───────────────────────── inline editors ───────────────────────── */

function CellEditor({
  task,
  columnKey,
  onDone,
}: {
  task: Task;
  columnKey: ColumnKey;
  onDone: () => void;
}) {
  if (columnKey === 'title') return <TitleEditor task={task} onDone={onDone} />;
  if (columnKey === 'priority') return <PriorityEditor task={task} onDone={onDone} />;
  // date columns
  const value =
    columnKey === 'dueDate'
      ? task.dueDate
      : columnKey === 'startDate'
        ? task.startDate
        : task.endDate;
  const save = (iso: string | null) => {
    const patch =
      columnKey === 'dueDate'
        ? { dueDate: iso }
        : columnKey === 'startDate'
          ? { startDate: iso }
          : { endDate: iso };
    void updateTask(task.localId, patch).catch((err) =>
      console.error('[table] failed to update date:', err),
    );
    onDone();
  };
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <DatePicker value={value} onChange={save} />
    </span>
  );
}

function TitleEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const [draft, setDraft] = useState(task.title);
  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.title) {
      void updateTask(task.localId, { title: trimmed }).catch((err) =>
        console.error('[table] failed to rename:', err),
      );
    }
    onDone();
  };
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          onDone();
        }
      }}
      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
    />
  );
}

function PriorityEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  return (
    <select
      autoFocus
      defaultValue={String(task.priority)}
      onClick={(e) => e.stopPropagation()}
      onBlur={onDone}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (next !== task.priority) {
          void updateTask(task.localId, { priority: next }).catch((err) =>
            console.error('[table] failed to set priority:', err),
          );
        }
        onDone();
      }}
      className="rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
    >
      {[0, 1, 2, 3, 4, 5].map((p) => (
        <option key={p} value={p}>
          {p === 0 ? 'None' : '!'.repeat(p)}
        </option>
      ))}
    </select>
  );
}

function DoneCheckbox({ task }: { task: Task }) {
  const handleToggle = async () => {
    const nowDone = !task.done;
    try {
      await updateTask(task.localId, { done: nowDone });
      if (nowDone) playCompletionSound();
    } catch (err) {
      console.error('[table] failed to toggle done:', err);
    }
  };
  return (
    <input
      type="checkbox"
      checked={task.done}
      onChange={handleToggle}
      onClick={(e) => e.stopPropagation()}
      aria-label={task.done ? 'Done' : 'Not done'}
      className="h-4 w-4 cursor-pointer rounded accent-[var(--color-primary)]"
    />
  );
}

function PercentCell({ value }: { value: number }) {
  if (!value) return <span className="text-[var(--color-muted-foreground)]">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)]">
        <span
          className="block h-full rounded-full bg-[var(--color-primary)]"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </span>
      <span className="tabular-nums text-[11px]">{Math.round(value)}%</span>
    </span>
  );
}
