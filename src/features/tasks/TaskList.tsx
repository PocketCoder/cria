import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReorderErrorPill } from '@/components/ReorderErrorPill';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useUi } from '@/stores/ui';
import { format } from 'date-fns';
import { toCalendarDate } from '@/lib/dateFormat';
import { useProjectTasks } from '@/queries/tasks';
import type { Project } from '@/domain/project';
import type { ProjectView } from '@/domain/view';
import type { Task } from '@/domain/task';
import { cn } from '@/lib/cn';
import { createTask, updateTask, reorderTask } from '@/db/tasks';
// import { calculatePosition } from '@/lib/position'; // Removed unused import
import { playCompletionSound } from '@/utils/sound';
import { applyLabelsByTitle } from '@/db/labels';
import { listSubtaskRelationsForProject } from '@/db/relations';
import { subscribe } from '@/db/bus';
import { Trash2, Plus, Loader2, Pencil, RefreshCw, Paperclip, CheckSquare, Square, ChevronDown, ChevronRight } from 'lucide-react';
import { useTaskLabels } from '@/queries/taskLabels';
import { useProjects } from '@/queries/projects';
import { useTasksWithAttachments } from '@/queries/attachments';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { LabelChips } from './LabelChips';
import { QuickAddPreview } from './QuickAddPreview';
import { TaskHoverPreview } from './TaskHoverPreview';
import { DatePicker } from '@/components/DatePicker';
import type { TaskInput } from '@/domain/task';
import { parseQuickAdd } from '@/lib/quickAddParser';


interface TaskListProps {
  project: Project;
  view?: ProjectView;
}

export function TaskList({ project, view }: TaskListProps) {
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project);

  const [newTitle, setNewTitle] = useState('');
  const [metadata, setMetadata] = useState<Partial<TaskInput>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Tasks queued for deletion are hidden immediately while the undo
  // toast is live (issue #25). They're still deleted=0 in the DB until
  // the undo window elapses, so we filter them out of the rendered list
  // here rather than touching the query data.
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const visibleTasks = tasks.filter((t) => !pendingDeletes[t.localId]);
  const [showCompleted, setShowCompleted] = useState(false);
  const activeTasks = useMemo(() => visibleTasks.filter((t) => !t.done), [visibleTasks]);
  const completedTasks = useMemo(() => visibleTasks.filter((t) => t.done), [visibleTasks]);
  const { data: attachmentIds } = useTasksWithAttachments();
  // Full project list so a parsed `+project` token can route the task to
  // a different project than the one currently open.
  const { data: allProjects = [] } = useProjects();
  const qc = useQueryClient();

  const { data: subtaskMap = new Map() } = useQuery({
    queryKey: ['subtasks', project.localId],
    queryFn: () => listSubtaskRelationsForProject(project.localId),
    staleTime: 30_000,
  });

  useEffect(() => subscribe('tasks', () => {
    qc.invalidateQueries({ queryKey: ['subtasks', project.localId] });
  }), [qc, project.localId]);

  const taskTree = useMemo(
    () => buildTaskTree(activeTasks, subtaskMap),
    [activeTasks, subtaskMap],
  );
  const completedTree = useMemo(
    () => buildTaskTree(completedTasks, subtaskMap),
    [completedTasks, subtaskMap],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState(false);
  const tasksRef = useRef(activeTasks);
  tasksRef.current = activeTasks;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  // Helper: collect the IDs of a task and all of its descendants from the task tree
  const collectSubtreeIds = (taskId: string, nodes: TaskTreeNode[]): string[] => {
    const result: string[] = [];
    const findNode = (list: TaskTreeNode[]): TaskTreeNode | undefined => {
      for (const n of list) {
        if (n.task.localId === taskId) return n;
        const child = findNode(n.children);
        if (child) return child;
      }
      return undefined;
    };
    const root = findNode(nodes);
    if (!root) return result;
    const dfs = (node: TaskTreeNode) => {
      result.push(node.task.localId);
      node.children.forEach(dfs);
    };
    dfs(root);
    return result;
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || !active || !view) return;

      const taskId = String(active.id);
      const overId = String(over.id);
      if (taskId === overId) return;

      // Build the block of IDs (parent + its whole subtree)
      const blockIds = collectSubtreeIds(taskId, taskTree);
      if (blockIds.length === 0) return;

      const current = tasksRef.current; // flat list of active tasks
      const flatIds = current.map((t) => t.localId);
      // Remove block IDs from the flat list
      const remaining = flatIds.filter((id) => !blockIds.includes(id));

      // Find insertion point based on the overId (a root task)
      const insertIdx = remaining.findIndex((id) => id === overId);
      const newOrder = [...remaining];
      if (insertIdx === -1) {
        // Append to the end if target not found
        newOrder.push(...blockIds);
      } else {
        newOrder.splice(insertIdx, 0, ...blockIds);
      }

      // Determine neighb­ors around the inserted block
      const blockStartIdx = newOrder.findIndex((id) => id === blockIds[0]);
      const beforeId = blockStartIdx > 0 ? newOrder[blockStartIdx - 1] : null;
      const afterId = blockStartIdx + blockIds.length < newOrder.length ? newOrder[blockStartIdx + blockIds.length] : null;
      const taskPositions = new Map(current.map((t) => [t.localId, t.position ?? 0]));
      const beforePos = beforeId ? taskPositions.get(beforeId) ?? null : null;
      const afterPos = afterId ? taskPositions.get(afterId) ?? null : null;

      // Compute positions for each task in the moved block
      const positions: number[] = [];
      if (beforePos != null && afterPos != null) {
        const gap = afterPos - beforePos;
        const step = gap / (blockIds.length + 1);
        for (let i = 1; i <= blockIds.length; i++) {
          positions.push(beforePos + step * i);
        }
      } else if (beforePos != null) {
        const step = 1024; // fallback step size
        for (let i = 0; i < blockIds.length; i++) {
          positions.push(beforePos + (i + 1) * step);
        }
      } else if (afterPos != null) {
        const step = 1024;
        for (let i = blockIds.length - 1; i >= 0; i--) {
          positions.push(afterPos - (blockIds.length - i) * step);
        }
      } else {
        // No neighbours – start from zero
        for (let i = 0; i < blockIds.length; i++) {
          positions.push(i * 1024);
        }
      }

      try {
        for (let i = 0; i < blockIds.length; i++) {
          await reorderTask(blockIds[i]!, view!.localId, positions[i] as number);
        }
      } catch (err) {
        console.error('[tasks] failed to reorder block:', err);
        setReorderError(true);
      }
    },
    [view, taskTree],
  );

  // Re-parsed on every keystroke. Pure function, cheap; no debounce
  // needed at the scale of an input field.
  const parsed = parseQuickAdd(newTitle);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.title && !metadata.dueDate && !metadata.priority) return;
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      // Merge: the explicit date/priority pickers win over the parser if
      // the user touched them; otherwise we lift from the parsed values.
      // A parsed `+project` token (case-insensitive title match) routes
      // the task to that project; otherwise it stays in the open one.
      const matchedProject = parsed.projectTitle
        ? allProjects.find(
            (p) => p.title.toLowerCase() === parsed.projectTitle!.toLowerCase(),
          )
        : undefined;
      const input: TaskInput = {
        title: parsed.title || newTitle.trim(),
        projectLocalId: matchedProject?.localId ?? project.localId,
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.priority !== null ? { priority: parsed.priority } : {}),
        ...(parsed.repeatAfter !== null ? { repeatAfter: parsed.repeatAfter } : {}),
        ...(parsed.repeatMode !== null ? { repeatMode: parsed.repeatMode } : {}),
        ...metadata,
      };

      const created = await createTask(input);

      // Apply parsed labels (the *label token): look up case-insensitively,
      // create any that don't exist yet, then apply. Prefix per Vikunja
      // default Quick Add Magic ('*' = label).
      if (parsed.labelTitles.length > 0 && created.localId) {
        try {
          await applyLabelsByTitle(created.localId, parsed.labelTitles);
        } catch (err) {
          console.warn('[quick-add] label application failed:', err);
        }
      }

      // +assignee tokens are not yet applied (no local users table)
      if (parsed.assigneeUsernames.length > 0) {
        console.info(
          '[quick-add] +assignee tokens are parsed but not yet applied:',
          parsed.assigneeUsernames,
        );
      }

      setNewTitle('');
      setMetadata({});
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {reorderError && <ReorderErrorPill onClose={() => setReorderError(false)} />}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-muted-foreground)]">
        <span>
          {activeTasks.length === 0 && completedTasks.length === 0
            ? isLoading
              ? 'Loading…'
              : 'No tasks'
            : `${activeTasks.length} task${activeTasks.length === 1 ? '' : 's'}`}
        </span>
        {isFetching ? <span aria-live="polite">syncing…</span> : null}
      </div>

      {/* Inline create — natural-language parsing on the title field
          (dates / @label / !priority / +assignee / #project). Explicit date
          + priority controls stay for users who'd rather not type the
          syntax; they override the parsed values when set. */}
      <form
        onSubmit={handleSubmit}
        className="border-b border-[var(--color-border)] px-6 py-3"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-4 w-4 items-center justify-center text-[var(--color-muted-foreground)]">
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </span>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a task… e.g. Buy milk tomorrow *groceries !2"
            disabled={isSubmitting}
            className="flex-1 bg-transparent text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none disabled:opacity-50"
          />
        </div>
        {/* Secondary row: explicit date + priority pickers. They override
            the NL-parsed values when touched, but live below the title so
            they don't crowd the primary input (issue #19). `pl-7` aligns
            them under the title input, past the plus-icon column. */}
        <div className="mt-2 flex items-center gap-3 pl-7 text-[var(--color-muted-foreground)]">
          <DatePicker
            value={metadata.dueDate ?? null}
            onChange={(iso) => setMetadata({ ...metadata, dueDate: iso })}
            placeholder="Due date"
            disabled={isSubmitting}
          />
          <select
            onChange={(e) =>
              setMetadata({ ...metadata, priority: Number(e.target.value) })
            }
            className="text-xs"
          >
            <option value="0">Priority 0</option>
            <option value="1">Priority 1</option>
            <option value="2">Priority 2</option>
            <option value="3">Priority 3</option>
            <option value="4">Priority 4</option>
            <option value="5">Priority 5</option>
          </select>
        </div>
        <QuickAddPreview parsed={parsed} />
      </form>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={taskTree.map((n) => n.task.localId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex-1 overflow-y-auto">
            {taskTree.map((node) => (
              <TreeBranch
                key={node.task.localId}
                node={node}
                depth={0}
                attachmentIds={attachmentIds}
                sortable
              />
            ))}
            {completedTasks.length > 0 ? (
              <li className="border-t border-[var(--color-border)]">
                <div className="mx-6 my-2 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-accent)]/5">
                  <button
                    type="button"
                    onClick={() => setShowCompleted((s) => !s)}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    {showCompleted ? (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    )}
                    {showCompleted ? 'Hide' : 'Show'} completed ({completedTasks.length})
                  </button>
                  {showCompleted ? (
                    <ul>
                      {completedTree.map((node) => (
                        <TreeBranch
                          key={node.task.localId}
                          node={node}
                          depth={0}
                          attachmentIds={attachmentIds}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ) : null}
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeId ? (
            <li className="flex items-start gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-6 py-3 shadow-lg opacity-90">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{tasks.find((t) => t.localId === activeId)?.title ?? ''}</p>
              </div>
            </li>
          ) : null}
        </DragOverlay>
      </DndContext>

      {isError ? (
        <p className="border-t border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-warning)]">
          Couldn't refresh
          {error instanceof Error ? `: ${error.message}` : ''}.
        </p>
      ) : null}
    </section>
  );
}

/* ─── Sub-task tree data structures ─── */

interface TaskTreeNode {
  task: Task;
  children: TaskTreeNode[];
}

function buildTaskTree(tasks: Task[], parentMap: Map<string, string[]>): TaskTreeNode[] {
  const taskMap = new Map(tasks.map((t) => [t.localId, t]));
  // Only treat a task as "nested" (and exclude it from the top level)
  // when its parent is actually present in the visible set. Otherwise a
  // child whose parent is filtered out (e.g. a done parent hidden by the
  // current view) — or a stale relation row whose parent task no longer
  // exists locally — would be dropped from roots but never rendered as a
  // child, making it vanish entirely.
  const childSet = new Set<string>();
  for (const [parentId, children] of parentMap) {
    if (!taskMap.has(parentId)) continue;
    for (const c of children) childSet.add(c);
  }

  function childrenOf(parentId: string): TaskTreeNode[] {
    return (parentMap.get(parentId) ?? [])
      .map((childId) => {
        const t = taskMap.get(childId);
        if (!t) return null;
        return { task: t, children: childrenOf(childId) };
      })
      .filter(Boolean) as TaskTreeNode[];
  }

  return tasks
    .filter((t) => !childSet.has(t.localId))
    .map((t) => ({ task: t, children: childrenOf(t.localId) }));
}

function TreeBranch({
  node,
  depth,
  attachmentIds,
  sortable,
}: {
  node: TaskTreeNode;
  depth: number;
  attachmentIds: Set<string> | undefined;
  sortable?: boolean;
}) {
  return (
    <>
      <TaskRow
        task={node.task}
        hasAttachments={attachmentIds?.has(node.task.localId) ?? false}
        depth={depth}
        sortable={sortable}
      />
      {node.children.map((child) => (
        <TreeBranch
          key={child.task.localId}
          node={child}
          depth={depth + 1}
          attachmentIds={attachmentIds}
        />
      ))}
    </>
  );
}

/* ─── Checklist progress from description HTML ─── */

function countChecklistItems(html: string | null | undefined): { checked: number; total: number } {
  if (!html) return { checked: 0, total: 0 };
  const inputs = html.match(/<input\s[^>]*?type="checkbox"[^>]*?>/gi) ?? [];
  let checked = 0;
  for (const input of inputs) {
    if (/\bchecked\s*[= >]/i.test(input)) checked++;
  }
  return { checked, total: inputs.length };
}

/* ─── Task row ─── */
function TaskRow({
  task,
  hasAttachments,
  depth = 0,
  sortable,
}: {
  task: Task;
  hasAttachments: boolean;
  depth?: number;
  sortable?: boolean;
}) {
  const selectedTaskId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { data: labels = [] } = useTaskLabels(task.localId);
  const enqueueDelete = usePendingDeletes((s) => s.enqueue);
  const checklist = countChecklistItems(task.description);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.localId,
    disabled: !sortable || editing,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${24 + depth * 28}px`,
  };

  const handleToggle = async () => {
    const nowDone = !task.done;
    try {
      await updateTask(task.localId, { done: nowDone });
      if (nowDone) playCompletionSound();
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  // Deferred delete: stash the task and show the undo toast. The real
  // deleteTask runs only if the undo window elapses (issue #25). The row
  // vanishes immediately because TaskList filters out pending tasks.
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    enqueueDelete(task);
  };

  const handleTitleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(task.title);
    setEditing(true);
  };

  const handleTitleSave = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.title) {
      await updateTask(task.localId, { title: trimmed });
    }
    setEditing(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleTitleSave();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-task-row=""
      className={cn(
        'group flex items-start gap-3 border-b border-[var(--color-border)] py-3 transition-colors hover:bg-[var(--color-accent)]/5',
        'px-6',
        task.done && 'opacity-60',
        selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
        isDragging && 'opacity-40',
        sortable && 'cursor-grab active:cursor-grabbing',
      )}
      onClick={() => { if (!editing) setSelectedTask(task.localId); }}
    >
      <input
        type="checkbox"
        checked={task.done}
        onChange={handleToggle}
        aria-label={task.done ? 'Done' : 'Not done'}
        className="mt-1 h-4 w-4 cursor-pointer accent-[var(--color-primary)] rounded border-[var(--color-border)] transition-all focus:ring-offset-0 focus:ring-0"
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void handleTitleSave()}
            onKeyDown={handleTitleKeyDown}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          />
        ) : (
            <TaskHoverPreview task={task}>
              <p
                className={cn(
                  'truncate rounded px-1 py-0.5 text-sm transition-all',
                  task.done && 'line-through text-[var(--color-muted-foreground)]',
                )}
                onDoubleClick={handleTitleEdit}
                title={task.title}
              >
                {task.title}
              </p>
            </TaskHoverPreview>
        )}
        {(task.dueDate || task.priority > 0 || labels.length > 0 || task.percentDone > 0 || task.repeatAfter > 0 || hasAttachments || checklist.total > 0) ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-muted-foreground)]">
            {task.dueDate ? (
              <span>Due {formatDate(task.dueDate)}</span>
            ) : null}
            {hasAttachments ? (
              <Paperclip className="h-3 w-3" aria-label="Has attachments" />
            ) : null}
            {checklist.total > 0 ? (
              <span className="flex items-center gap-1">
                {checklist.checked === checklist.total ? (
                  <CheckSquare className="h-3 w-3 shrink-0 text-[var(--color-primary)]" />
                ) : (
                  <Square className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
                )}
                <span className="tabular-nums">{checklist.checked}/{checklist.total}</span>
              </span>
            ) : null}
            {task.priority > 0 ? (
              <span aria-label={`Priority ${task.priority}`}>
                {'!'.repeat(Math.min(5, task.priority))}
              </span>
            ) : null}
            <LabelChips labels={labels} />
            {task.percentDone > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)]">
                  <span
                    className="block h-full rounded-full bg-[var(--color-primary)] transition-all"
                    style={{ width: `${Math.min(100, task.percentDone)}%` }}
                  />
                </span>
                <span className="tabular-nums">{Math.round(task.percentDone)}%</span>
              </span>
            ) : null}
            {task.repeatAfter > 0 ? (
              <RefreshCw className="h-3 w-3" aria-label="Repeating" />
            ) : null}
          </div>
        ) : null}
      </div>
      {task.hexColor ? (
        <span
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: task.hexColor }}
        />
      ) : null}
      {/* Hover actions. `mt-1` matches the checkbox so the icons sit on
          the title baseline (issue #21). Pencil enters inline rename —
          the explicit affordance now that single-click on the title
          opens detail instead of editing (issue #20). */}
      <div className="mt-1 flex items-center gap-1">
        <button
          onClick={handleTitleEdit}
          aria-label="Rename task"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDelete}
          aria-label="Delete task"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-warning)] cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    return format(toCalendarDate(iso), 'd MMM');
  } catch {
    return iso;
  }
}
