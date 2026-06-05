import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Pencil, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useProjectTasks } from '@/queries/tasks';
import { useProjects } from '@/queries/projects';
import { useCurrentUser } from '@/queries/user';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useUi } from '@/stores/ui';
import { updateTask, reorderTask } from '@/db/tasks';
import { calculatePosition } from '@/lib/position';
import { playCompletionSound } from '@/utils/sound';
import { cn } from '@/lib/cn';
import type { Project } from '@/domain/project';
import type { ProjectView } from '@/domain/view';
import type { Task, TaskUpdate } from '@/domain/task';
import {
  useTableConfig,
  sortTasks,
  type ColumnKey,
  type ColumnDef,
} from './useTableConfig';
import { SortHeader } from './SortHeader';
import { TableColumnPopup } from './TableColumnPopup';
import { DateCell } from './DateCell';
import { LabelCell } from './LabelCell';
import { LabelEditCell } from './LabelEditCell';
import { AssigneeCell } from './AssigneeCell';

interface TableViewProps {
  project: Project;
  view?: ProjectView;
}

interface SortableRowProps {
  task: Task;
  shownColumns: ColumnDef[];
  editMode: boolean;
  drafts: Record<string, DraftFields>;
  setDraft: (localId: string, field: keyof DraftFields, value: unknown) => void;
  projectTitle: (id: string) => string;
  currentUserServerId: number | null;
  selectedTaskId: string | null;
  setSelectedTask: (id: string | null) => void;
}

const EDITABLE_COLUMNS = new Set<ColumnKey>([
  'title',
  'priority',
  'dueDate',
  'startDate',
  'endDate',
  'percentDone',
  'labels',
]);

function SortableTableRow({
  task,
  shownColumns,
  editMode,
  drafts,
  setDraft,
  projectTitle,
  currentUserServerId,
  selectedTaskId,
  setSelectedTask,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.localId,
    disabled: editMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={editMode ? undefined : () => setSelectedTask(task.localId)}
      className={cn(
        'border-b border-[var(--color-border)] transition-colors',
        !editMode && 'cursor-grab hover:bg-[var(--color-accent)]/5 active:cursor-grabbing',
        task.done && 'opacity-60',
        selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
        isDragging && 'opacity-40',
      )}
    >
      {shownColumns.map((c) => {
        const editable = editMode && EDITABLE_COLUMNS.has(c.key);
        return (
          <td
            key={c.key}
            className="px-3 py-2 align-middle text-[var(--color-foreground)]"
          >
            {editable ? (
              <EditField
                task={task}
                columnKey={c.key}
                draft={drafts[task.localId]}
                onChange={(field, value) => setDraft(task.localId, field, value)}
              />
            ) : (
              <Cell
                task={task}
                columnKey={c.key}
                projectTitle={projectTitle}
                currentUserServerId={currentUserServerId}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Dense, sortable, multi-column table view. Reads the same
 * `useProjectTasks` data as the list view; column visibility + sort are
 * driven by `useTableConfig` (global localStorage). Row click opens the
 * task detail card, like the list view.
 */
export function TableView({ project, view }: TableViewProps) {
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project);
  const { data: allProjects = [] } = useProjects();
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const { columns, visible, sortBy, toggleColumn, onSort } = useTableConfig();
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const selectedTaskId = useUi((s) => s.selectedTaskLocalId);
  const { data: currentUser } = useCurrentUser();

  const [activeId, setActiveId] = useState<string | null>(null);
  const sortedRef = useRef<Task[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || !active || !view) return;

      const taskId = String(active.id);
      const overId = String(over.id);
      if (taskId === overId) return;

      const current = sortedRef.current;
      const taskPositions = new Map(current.map((t) => [t.localId, t.position ?? 0]));

      const oldIdx = current.findIndex((t) => t.localId === taskId);
      const newIdx = current.findIndex((t) => t.localId === overId);
      if (oldIdx === -1 || newIdx === -1) return;

      const ids = current.map((t) => t.localId);
      const reordered = [...ids];
      reordered.splice(oldIdx, 1);
      reordered.splice(newIdx, 0, taskId);
      const idx = reordered.indexOf(taskId);
      const beforeId = idx > 0 ? reordered[idx - 1] : null;
      const afterId = idx < reordered.length - 1 ? reordered[idx + 1] : null;
      const beforePos = beforeId ? taskPositions.get(beforeId) ?? null : null;
      const afterPos = afterId ? taskPositions.get(afterId) ?? null : null;
      const position = calculatePosition(beforePos, afterPos);

      try {
        await reorderTask(taskId, view.localId, position);
      } catch (err) {
        console.error('[table] failed to reorder task:', err);
      }
    },
    [view],
  );

  // Table-wide edit mode: a single toggle turns every editable cell into an
  // input. Edits accumulate in `drafts` (keyed by task) and are written on
  // Save — or auto-saved when leaving the table (view/project switch, unmount).
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const flush = useCallback((pending: Record<string, DraftFields>) => {
    for (const [localId, patch] of Object.entries(pending)) {
      if (patch && Object.keys(patch).length > 0) {
        void updateTask(localId, patch).catch((err) =>
          console.error('[table] failed to save edit:', err),
        );
      }
    }
  }, []);

  const setDraft = useCallback(
    (localId: string, field: keyof DraftFields, value: unknown) => {
      setDrafts((prev) => ({
        ...prev,
        [localId]: { ...prev[localId], [field]: value } as DraftFields,
      }));
    },
    [],
  );

  const saveAndExit = useCallback(() => {
    flush(draftsRef.current);
    setDrafts({});
    setEditMode(false);
  }, [flush]);

  // Leaving the table (project switch or unmount) flushes pending drafts and
  // resets edit state, so nothing is silently lost.
  useEffect(() => {
    setDrafts({});
    setEditMode(false);
    return () => {
      flush(draftsRef.current);
    };
  }, [project.localId, flush]);

  const projectTitle = useMemo(() => {
    const map = new Map(allProjects.map((p) => [p.localId, p.title]));
    return (id: string) => map.get(id) ?? '';
  }, [allProjects]);

  const visibleTasks = useMemo(
    () => tasks.filter((t) => !pendingDeletes[t.localId]),
    [tasks, pendingDeletes],
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const activeTasks = useMemo(() => visibleTasks.filter((t) => !t.done), [visibleTasks]);
  const completedTasks = useMemo(() => visibleTasks.filter((t) => t.done), [visibleTasks]);

  const sorted = useMemo(
    () => sortTasks(activeTasks, sortBy, { projectTitle, visible }),
    [activeTasks, sortBy, projectTitle, visible],
  );
  useEffect(() => { sortedRef.current = sorted; }, [sorted]);
  const sortedCompleted = useMemo(
    () => sortTasks(completedTasks, sortBy, { projectTitle, visible }),
    [completedTasks, sortBy, projectTitle, visible],
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
          {activeTasks.length === 0 && completedTasks.length === 0
            ? isLoading
              ? 'Loading…'
              : 'No tasks'
            : `${activeTasks.length} task${activeTasks.length === 1 ? '' : 's'}`}
          {isFetching ? <span className="ml-2">syncing…</span> : null}
        </span>
        <div className="flex items-center gap-2">
          {editMode ? (
            <button
              type="button"
              onClick={saveAndExit}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              <Check className="h-3.5 w-3.5" />
              Save
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (editMode ? saveAndExit() : setEditMode(true))}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
              editMode
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
            )}
            aria-pressed={editMode}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editMode ? 'Editing' : 'Edit'}
          </button>
          <TableColumnPopup visible={visible} onToggle={toggleColumn} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
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
            <SortableContext
              items={sorted.map((t) => t.localId)}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {sorted.map((task) => (
                  <SortableTableRow
                    key={task.localId}
                    task={task}
                    shownColumns={shownColumns}
                    editMode={editMode}
                    drafts={drafts}
                    setDraft={setDraft}
                    projectTitle={projectTitle}
                    currentUserServerId={currentUser?.serverId ?? null}
                    selectedTaskId={selectedTaskId}
                    setSelectedTask={setSelectedTask}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
          <DragOverlay>
            {activeId ? (
              <table className="w-full border-collapse text-sm">
                <tbody>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-card)] shadow-lg opacity-90">
                    <td className="px-3 py-2 text-sm">
                      {tasks.find((t) => t.localId === activeId)?.title ?? ''}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
          </DragOverlay>
          {completedTasks.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <tbody>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-accent)]/5">
                  <td
                    colSpan={shownColumns.length}
                    className="px-6 py-2 text-xs text-[var(--color-muted-foreground)]"
                  >
                    <button
                      type="button"
                      onClick={() => setShowCompleted((s) => !s)}
                      className="flex w-full cursor-pointer items-center gap-2 hover:text-[var(--color-foreground)]"
                    >
                      {showCompleted ? (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      )}
                      {showCompleted ? 'Hide' : 'Show'} completed ({completedTasks.length})
                    </button>
                  </td>
                </tr>
                {showCompleted && sortedCompleted.map((task) => (
                  <tr
                    key={task.localId}
                    onClick={editMode ? undefined : () => setSelectedTask(task.localId)}
                    className={cn(
                      'border-b border-[var(--color-border)] transition-colors',
                      !editMode && 'cursor-pointer hover:bg-[var(--color-accent)]/5',
                      task.done && 'opacity-60',
                      selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
                    )}
                  >
                    {shownColumns.map((c) => {
                      const editable = editMode && EDITABLE_COLUMNS.has(c.key);
                      return (
                        <td
                          key={c.key}
                          className="px-3 py-2 align-middle text-[var(--color-foreground)]"
                        >
                          {editable ? (
                            <EditField
                              task={task}
                              columnKey={c.key}
                              draft={drafts[task.localId]}
                              onChange={(field, value) => setDraft(task.localId, field, value)}
                            />
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
          ) : null}
        </DndContext>

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

/* ───────────────────────── inline edit fields ───────────────────────── */

type DraftFields = Partial<
  Pick<TaskUpdate, 'title' | 'priority' | 'dueDate' | 'startDate' | 'endDate' | 'percentDone'>
>;

const EDIT_INPUT_CLS =
  'w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]';

/** ISO (midnight UTC) → `YYYY-MM-DD` for a native date input. */
function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
/** `YYYY-MM-DD` → midnight-UTC ISO, or null when cleared. */
function fromDateInputValue(v: string): string | null {
  return v ? `${v}T00:00:00.000Z` : null;
}

/**
 * The editable form control for one cell while the table is in edit mode.
 * Reads its value from the row's draft (falling back to the task) and reports
 * changes up to the table's draft state. Native `<input type="date">` avoids a
 * custom popover.
 */
function EditField({
  task,
  columnKey,
  draft,
  onChange,
}: {
  task: Task;
  columnKey: ColumnKey;
  draft: DraftFields | undefined;
  onChange: (field: keyof DraftFields, value: unknown) => void;
}) {
  switch (columnKey) {
    case 'labels':
      // Labels are a relation, not a draft field — toggled immediately.
      return <LabelEditCell taskLocalId={task.localId} />;
    case 'title':
      return (
        <input
          type="text"
          value={draft?.title ?? task.title}
          onChange={(e) => onChange('title', e.target.value)}
          className={EDIT_INPUT_CLS}
        />
      );
    case 'priority':
      return (
        <select
          value={String(draft?.priority ?? task.priority)}
          onChange={(e) => onChange('priority', Number(e.target.value))}
          className={EDIT_INPUT_CLS}
        >
          {[0, 1, 2, 3, 4, 5].map((p) => (
            <option key={p} value={p}>
              {p === 0 ? 'None' : '!'.repeat(p)}
            </option>
          ))}
        </select>
      );
    case 'percentDone':
      return (
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={draft?.percentDone ?? task.percentDone}
          onChange={(e) =>
            onChange('percentDone', Math.max(0, Math.min(100, Number(e.target.value))))
          }
          className={EDIT_INPUT_CLS}
        />
      );
    case 'dueDate':
    case 'startDate':
    case 'endDate': {
      const current =
        columnKey === 'dueDate'
          ? task.dueDate
          : columnKey === 'startDate'
            ? task.startDate
            : task.endDate;
      const draftVal = draft?.[columnKey];
      const value = draftVal !== undefined ? draftVal : current;
      return (
        <input
          type="date"
          value={toDateInputValue(value)}
          onChange={(e) => onChange(columnKey, fromDateInputValue(e.target.value))}
          className={EDIT_INPUT_CLS}
        />
      );
    }
    default:
      return null;
  }
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
