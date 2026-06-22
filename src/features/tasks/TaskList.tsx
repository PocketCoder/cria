import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ReorderErrorPill } from '@/components/ReorderErrorPill';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
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
import { createTask, updateTask, duplicateTask, reorderTask, reindexTasks } from '@/db/tasks';
import { planReorder } from '@/lib/position';
import { playCompletionSound } from '@/utils/sound';
import { applyLabelsByTitle } from '@/db/labels';
import { listSubtaskRelationsForProject } from '@/db/relations';
import { subscribe } from '@/db/bus';
import { ArrowUpDown, Filter, Trash2, Plus, Loader2, Pencil, RefreshCw, Paperclip, CheckSquare, Square, ChevronDown, ChevronRight, X, Copy, ExternalLink } from 'lucide-react';
import { useTaskLabels } from '@/queries/taskLabels';
import { useProjects } from '@/queries/projects';
import { useTasksWithAttachments } from '@/queries/attachments';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useFilterSort } from '@/stores/filterSort';
import { SORT_OPTIONS, type SortRule } from '@/lib/sortEngine';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { LabelChips } from './LabelChips';
import { QuickAddPreview } from './QuickAddPreview';
import { TaskHoverPreview } from './TaskHoverPreview';
import { DatePicker } from '@/components/DatePicker';
import { PrioritySelect } from '@/components/ui/priority-select';
import { LabelPicker } from '@/components/ui/label-picker';
import { RecurrencePicker } from '@/components/ui/recurrence-picker';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { TaskInput } from '@/domain/task';
import { parseQuickAdd } from '@/lib/quickAddParser';

// Collect a task and all its descendants from the task tree
function collectSubtreeIds(taskId: string, nodes: TaskTreeNode[]): string[] {
  const find = (list: TaskTreeNode[]): TaskTreeNode | undefined => {
    for (const n of list) {
      if (n.task.localId === taskId) return n;
      const child = find(n.children);
      if (child) return child;
    }
    return undefined;
  };
  const root = find(nodes);
  if (!root) return [];
  const out: string[] = [];
  const dfs = (n: TaskTreeNode) => { out.push(n.task.localId); n.children.forEach(dfs); };
  dfs(root);
  return out;
}



interface TaskListProps {
  project: Project;
  view?: ProjectView;
}

export function TaskList({ project, view }: TaskListProps) {
  const {
    filterQuery,
    sortRule,
    showFilterBar,
    showSortMenu,
    setFilterQuery,
    setSortRule,
    setShowFilterBar,
    setShowSortMenu,
  } = useFilterSort();

  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project, filterQuery || undefined, sortRule);

  const [newTitle, setNewTitle] = useState('');
  const [metadata, setMetadata] = useState<Partial<TaskInput>>({});
  const [labelTitles, setLabelTitles] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterDraft, setFilterDraft] = useState(filterQuery);

  useEffect(() => {
    setFilterDraft(filterQuery);
  }, [filterQuery]);

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
  const {
    data: subtaskMap = new Map()
  } = useQuery({
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

  // DnD Kit's SortableContext must see the items change synchronously in
  // onDragEnd, otherwise it reverts the CSS transform (snap-back). We keep
  // a state array that we update directly, separate from the query cache,
  // AND drive the rendered root order from it (see `orderedRoots`) so the
  // DOM and the SortableContext never disagree about where a row sits.
  const [sortableItems, setSortableItems] = useState<string[]>(() =>
    taskTree.map((n) => n.task.localId),
  );
  // Sync with taskTree when the query refetches, but avoid infinite loops:
  // return the same reference from the updater when IDs are unchanged.
  useEffect(() => {
    setSortableItems((prev) => {
      const next = taskTree.map((n) => n.task.localId);
      if (prev.length === next.length && prev.every((id, i) => id === next[i])) {
        return prev;
      }
      return next;
    });
  }, [taskTree]);

  // Render the active roots in `sortableItems` order so an optimistic reorder
  // shows up in the DOM in the same commit that updates the SortableContext —
  // the row stays where it was dropped instead of snapping back to the old
  // query order. Roots not yet reflected in `sortableItems` (e.g. a just-added
  // task, before the sync effect runs) are appended so nothing flashes out.
  const orderedRoots = useMemo(() => {
    const byId = new Map(taskTree.map((n) => [n.task.localId, n]));
    const seen = new Set<string>();
    const ordered: TaskTreeNode[] = [];
    for (const id of sortableItems) {
      const node = byId.get(id);
      if (node) {
        ordered.push(node);
        seen.add(id);
      }
    }
    for (const node of taskTree) {
      if (!seen.has(node.task.localId)) ordered.push(node);
    }
    return ordered;
  }, [taskTree, sortableItems]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Touch: long-press to grab, so vertical scrolling still works on a phone.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
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

      // Resolve the drop target to the top‑level root (only roots are sortable).
      // If the pointer lands on a child we treat it as dropping onto its parent root.
      let targetId = overId;
      for (const root of taskTree) {
        if (collectSubtreeIds(root.task.localId, taskTree).includes(overId)) {
          targetId = root.task.localId;
          break;
        }
      }
      if (taskId === targetId) return;

      // Reordering happens among the ROOT tasks only — subtasks ride along
      // with their parent — so compute against the root list, not the flat
      // activeTasks list (which interleaves children and would yield the
      // wrong neighbours / positions).
      const roots = taskTree.map((n) => n.task);
      const oldIdx = roots.findIndex((t) => t.localId === taskId);
      const newIdx = roots.findIndex((t) => t.localId === targetId);
      if (oldIdx === -1 || newIdx === -1) return;

      const reordered = arrayMove(roots, oldIdx, newIdx);
      const orderedIds = reordered.map((t) => t.localId);

      // Update sortable items synchronously. The rendered list is driven by
      // this same array (see `orderedRoots`), so the row stays exactly where
      // it was dropped — no snap-back — until the query refetch confirms it.
      setSortableItems(orderedIds);

      // Midpoint only works when the neighbours have distinct, non-null
      // positions. Locally-created tasks start at position=null, so the first
      // reorder (or a collision) re-indexes the whole list to lay down a clean
      // spread; steady state stays on the cheap single write.
      const positions = new Map(reordered.map((t) => [t.localId, t.position]));
      const plan = planReorder(orderedIds, taskId, (id) => positions.get(id));
      try {
        if (plan.type === 'midpoint') {
          await reorderTask(taskId, view.localId, plan.position);
        } else {
          await reindexTasks(orderedIds, view.localId);
        }
      } catch (err) {
        console.error('[tasks] failed to reorder task:', err);
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

      // Apply labels from the picker plus any typed *label tokens
      // (case-insensitive union); create-if-missing, then apply.
      const allLabelTitles = [
        ...labelTitles,
        ...parsed.labelTitles.filter(
          (t) => !labelTitles.some((s) => s.toLowerCase() === t.toLowerCase()),
        ),
      ];
      if (allLabelTitles.length > 0 && created.localId) {
        try {
          await applyLabelsByTitle(created.localId, allLabelTitles);
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
      setLabelTitles([]);
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {reorderError && <ReorderErrorPill onClose={() => setReorderError(false)} />}
      <div className="border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between px-6 py-2 text-xs text-[var(--color-muted-foreground)]">
          <div className="flex items-center gap-2">
            <span>
              {activeTasks.length === 0 && completedTasks.length === 0
                ? isLoading
                  ? 'Loading…'
                  : 'No tasks'
                : `${activeTasks.length} task${activeTasks.length === 1 ? '' : 's'}`}
            </span>
            <button
              onClick={() => { setShowFilterBar(!showFilterBar); setShowSortMenu(false); }}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors cursor-pointer',
                showFilterBar || filterQuery
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'hover:bg-[var(--color-accent)]/10',
              )}
              title="Filter tasks"
            >
              <Filter className="h-3 w-3" />
              {filterQuery ? 'Filtered' : 'Filter'}
            </button>
            <button
              onClick={() => { setShowSortMenu(!showSortMenu); setShowFilterBar(false); }}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors cursor-pointer',
                showSortMenu || sortRule
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'hover:bg-[var(--color-accent)]/10',
              )}
              title="Sort tasks"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortRule
                ? SORT_OPTIONS.find((o) => o.field === sortRule.field && o.direction === sortRule.direction)?.label ?? 'Sorted'
                : 'Sort'}
            </button>
          </div>
          {isFetching ? <span aria-live="polite">syncing…</span> : null}
        </div>

        {showFilterBar ? (
          <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-6 py-1.5">
            <input
              type="text"
              value={filterDraft}
              onChange={(e) => setFilterDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setFilterQuery(filterDraft);
                } else if (e.key === 'Escape') {
                  setFilterDraft(filterQuery);
                  setShowFilterBar(false);
                }
              }}
              placeholder='e.g. priority >= 3 && dueDate <= now'
              className="flex-1 bg-transparent text-xs placeholder-[var(--color-muted-foreground)] focus:outline-none"
              autoFocus
            />
            <button
              onClick={() => { setFilterQuery(filterDraft); }}
              className="rounded px-2 py-0.5 text-xs bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              Apply
            </button>
            <button
              onClick={() => {
                setFilterDraft('');
                setFilterQuery('');
                setShowFilterBar(false);
              }}
              className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--color-accent)]/10 transition-colors cursor-pointer"
              title="Clear filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        {showSortMenu ? (
          <div className="border-t border-[var(--color-border)] px-6 py-1.5">
            <Select
              value={sortRule ? `${sortRule.field}:${sortRule.direction}` : 'default'}
              onValueChange={(val) => {
                if (val === 'default') {
                  setSortRule(null);
                } else {
                  const [field, dir] = val.split(':') as [SortRule['field'], SortRule['direction']];
                  setSortRule({ field, direction: dir });
                }
              }}
            >
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="Default order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default order</SelectItem>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.label} value={`${opt.field}:${opt.direction}`}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {/* Inline create — natural-language parsing on the title field
          (dates / @label / !priority / +assignee / #project). Explicit date
          + priority controls stay for users who'd rather not type the
          syntax; they override the parsed values when set. */}
      <form
        onSubmit={handleSubmit}
        className="border-b border-[var(--color-border)] px-6 pt-3 pb-4"
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
        {/* Secondary row: explicit pickers for every NL-settable field (date,
            priority, labels, recurrence). They override the NL-parsed values
            when touched, but live below the title so they don't crowd the
            primary input (issue #19). `pl-7` aligns them under the title input,
            past the plus-icon column. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-[var(--color-muted-foreground)]">
          <DatePicker
            value={metadata.dueDate ?? null}
            onChange={(iso) => setMetadata({ ...metadata, dueDate: iso })}
            placeholder="Due date"
            disabled={isSubmitting}
          />
          <PrioritySelect
            className="w-auto"
            value={metadata.priority ?? parsed.priority ?? 0}
            onChange={(p) => setMetadata({ ...metadata, priority: p })}
            compact
          />
          <LabelPicker value={labelTitles} onChange={setLabelTitles} />
          <RecurrencePicker
            repeatAfter={metadata.repeatAfter ?? parsed.repeatAfter ?? null}
            repeatMode={metadata.repeatMode ?? parsed.repeatMode ?? null}
            onChange={(after, mode) =>
              setMetadata({
                ...metadata,
                repeatAfter: after ?? undefined,
                repeatMode: mode ?? undefined,
              })
            }
          />
        </div>
        <QuickAddPreview parsed={parsed} />
      </form>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortableItems}
          strategy={verticalListSortingStrategy}
        >
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {orderedRoots.map((node) => (
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

const TreeBranch = memo(function TreeBranch({
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
});

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
const TaskRow = memo(function TaskRow({
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
  const checklist = useMemo(
    () => countChecklistItems(task.description),
    [task.description],
  );
  const dueLabel = useMemo(
    () => (task.dueDate ? formatDate(task.dueDate) : null),
    [task.dueDate],
  );

  const handleToggle = useCallback(async () => {
    const nowDone = !task.done;
    try {
      await updateTask(task.localId, { done: nowDone });
      if (nowDone) {
        playCompletionSound();
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  }, [task.localId, task.done]);

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
    paddingRight: 0,
    overflow: 'hidden',
    position: 'relative',
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          data-task-row=""
          className={cn(
            'group flex items-start gap-3 border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)]/5',
            task.done && 'opacity-60',
            selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
            isDragging && 'opacity-40',
            sortable && 'cursor-grab active:cursor-grabbing',
          )}
          onClick={() => { if (!editing) setSelectedTask(task.localId); }}
        >
          <div className="flex w-full items-start gap-3 pr-6 py-3">
            <input
              type="checkbox"
              checked={task.done}
              onChange={handleToggle}
              onClick={(e) => e.stopPropagation()}
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
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-[var(--color-muted-foreground)]">
                  {task.dueDate ? (
                    <span>Due {dueLabel}</span>
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
                className="hover-reveal p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDelete}
                aria-label="Delete task"
                className="hover-reveal p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-warning)] cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => setSelectedTask(task.localId)}>
          <span className="flex items-center gap-2">
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => { setDraft(task.title); setEditing(true); }}>
          <span className="flex items-center gap-2">
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => { duplicateTask(task.localId).catch(console.error); }}>
          <span className="flex items-center gap-2">
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => enqueueDelete(task)}>
          <span className="flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

function formatDate(iso: string): string {
  try {
    return format(toCalendarDate(iso), 'd MMM');
  } catch {
    return iso;
  }
}
