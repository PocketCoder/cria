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
import { useProjectTasks } from '@/queries/tasks';
import type { Project } from '@/domain/project';
import { viewFilterParams } from '@/domain/view';
import type { ProjectView } from '@/domain/view';
import type { Task } from '@/domain/task';
import { cn } from '@/lib/cn';
import { updateTask, duplicateTask, reorderTask, reindexTasks } from '@/db/tasks';
import { planReorder } from '@/lib/position';
import { listSubtaskRelationsForProject } from '@/db/relations';
import { subscribe } from '@/db/bus';
import { Trash2, Pencil, Copy, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useTaskLabels } from '@/queries/taskLabels';
import { useTasksWithAttachments } from '@/queries/attachments';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useListFocus } from '@/stores/listFocus';
import { onShortcut } from '@/lib/shortcutBus';
import { useDisplay } from '@/stores/display';
import { useDisplayCtx } from '@/queries/displayData';
import { filterTasks, sortTasks, defaultConfigFor } from '@/lib/displayConfig';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { useIsMobile } from '@/lib/useIsMobile';
import { TaskHoverPreview } from './TaskHoverPreview';
import { TaskRowCore, countChecklistItems } from './TaskRowCore';

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
  const isMobile = useIsMobile();
  const ctx = useDisplayCtx();
  const vKey = `project:${project.localId}` as const;
  const storedConfig = useDisplay((s) => s.configs[vKey]);
  const config = useMemo(
    () => storedConfig ?? defaultConfigFor(vKey),
    [storedConfig, vKey],
  );
  // Manual order is the only mode where drag-to-reorder is the source of
  // truth; any other sort renders in sorted order and disables dragging.
  const sortable = config.sort.field === 'manual';

  // Vikunja views can carry their own filter (project_views.filter).
  const vf = view ? viewFilterParams(view) : null;
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project, vf?.filter, undefined, vf?.includeNulls ?? false);

  // Tasks queued for deletion are hidden immediately while the undo
  // toast is live (issue #25). They're still deleted=0 in the DB until
  // the undo window elapses, so we filter them out of the rendered list
  // here rather than touching the query data. Then the DisplayConfig
  // filter/sort runs client-side — the same engine the smart views use.
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const showCompleted = config.showCompleted;
  const matched = useMemo(
    () => filterTasks(tasks.filter((t) => !pendingDeletes[t.localId]), ctx, config.filters),
    [tasks, pendingDeletes, ctx, config.filters],
  );
  const activeTasks = useMemo(
    () => sortTasks(matched.filter((t) => !t.done), config.sort),
    [matched, config.sort],
  );
  const completedTasks = useMemo(
    () => sortTasks(matched.filter((t) => t.done), config.sort),
    [matched, config.sort],
  );
  const { data: attachmentIds } = useTasksWithAttachments();
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

  // j/k/Enter row focus (fixed shortcut set). Moves through the visible
  // tree in display order; Enter opens the focused task's detail card.
  useEffect(() => {
    const flatIds = (): string[] => {
      const out: string[] = [];
      const dfs = (nodes: TaskTreeNode[]) => {
        for (const n of nodes) {
          out.push(n.task.localId);
          dfs(n.children);
        }
      };
      dfs(taskTree);
      return out;
    };
    const move = (delta: 1 | -1) => {
      const ids = flatIds();
      if (ids.length === 0) return;
      const { focusedId, setFocusedId } = useListFocus.getState();
      const idx = focusedId ? ids.indexOf(focusedId) : -1;
      const next = ids[Math.min(ids.length - 1, Math.max(0, idx + delta))]!;
      setFocusedId(next);
      document
        .querySelector(`[data-task-row="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    const subs = [
      onShortcut('list.down', () => move(1)),
      onShortcut('list.up', () => move(-1)),
      onShortcut('list.open', () => {
        const { focusedId } = useListFocus.getState();
        if (focusedId) useUi.getState().setSelectedTask(focusedId);
      }),
    ];
    return () => {
      subs.forEach((u) => u());
      useListFocus.getState().setFocusedId(null);
    };
  }, [taskTree]);

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

  return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {reorderError && <ReorderErrorPill onClose={() => setReorderError(false)} />}
      <div className="border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between px-7 py-2 text-xs text-[var(--color-muted-foreground)]">
          <span>
            {activeTasks.length === 0 && completedTasks.length === 0
              ? isLoading
                ? 'Loading…'
                : 'No tasks'
              : `${activeTasks.length} task${activeTasks.length === 1 ? '' : 's'}`}
          </span>
          {isFetching ? <span aria-live="polite">syncing…</span> : null}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortableItems}
          strategy={verticalListSortingStrategy}
        >
          <ul className={cn('min-h-0 flex-1 overflow-y-auto', isMobile && 'tab-bar-safe-bottom')}>
            {orderedRoots.map((node) => (
              <TreeBranch
                key={node.task.localId}
                node={node}
                depth={0}
                attachmentIds={attachmentIds}
                sortable={sortable}
              />
            ))}
            {/* Completed tasks show inline (greyed) when the Display sheet's
                "Completed Tasks" toggle is on, and are hidden otherwise. */}
            {showCompleted && completedTasks.length > 0 ? (
              <li className="border-t border-[var(--color-border)]">
                <h2 className="px-7 py-1.5 text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  Completed
                  <span className="ml-2 font-normal normal-case">{completedTasks.length}</span>
                </h2>
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
              </li>
            ) : null}
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeId ? (
            <li className="flex items-start gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-7 py-3 shadow-lg opacity-90">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{tasks.find((t) => t.localId === activeId)?.title ?? ''}</p>
              </div>
            </li>
          ) : null}
        </DragOverlay>
      </DndContext>

      {isError ? (
        <p className="border-t border-[var(--color-border)] px-7 py-2 text-xs text-[var(--color-warning)]">
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
  const isKeyFocused = useListFocus((s) => s.focusedId === task.localId);
  const selecting = useDisplay((s) => s.selecting);
  const isSelected = useDisplay((s) => !!s.selected[task.localId]);
  const toggleSelected = useDisplay((s) => s.toggleSelected);
  const startSelecting = useDisplay((s) => s.startSelecting);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { data: labels = [] } = useTaskLabels(task.localId);
  const enqueueDelete = usePendingDeletes((s) => s.enqueue);
  const checklist = useMemo(
    () => countChecklistItems(task.description),
    [task.description],
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.localId,
    disabled: !sortable || editing || selecting,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${28 + depth * 28}px`,
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

  const handleOpen = () => {
    if (editing) return;
    if (selecting) toggleSelected(task.localId);
    else setSelectedTask(task.localId);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          className={cn(
            'border-b border-[var(--color-border)]',
            isKeyFocused && 'ring-1 ring-inset ring-[var(--color-primary)]',
            isDragging && 'opacity-40',
            sortable && !selecting && 'cursor-grab active:cursor-grabbing',
          )}
        >
          <TaskRowCore
            task={task}
            labels={labels}
            hasAttachments={hasAttachments}
            checklist={checklist}
            selecting={selecting}
            isSelected={isSelected}
            isOpen={!isSelected && selectedTaskId === task.localId}
            onToggleSelect={() => toggleSelected(task.localId)}
            onOpen={handleOpen}
            className="py-2.5 pr-6"
            titleSlot={
              editing ? (
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void handleTitleSave()}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                />
              ) : (
                <TaskHoverPreview task={task} className="min-w-0 flex-1">
                  <p
                    className="truncate rounded px-1 py-0.5 text-sm"
                    onDoubleClick={handleTitleEdit}
                    title={task.title}
                  >
                    {task.title}
                  </p>
                </TaskHoverPreview>
              )
            }
            actions={
              <div className="flex items-center gap-1">
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
            }
          />
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
        <ContextMenuItem onSelect={() => startSelecting(task.localId)}>
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Select
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
