import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUi } from '@/stores/ui';
import { format } from 'date-fns';
import { useProjectTasks } from '@/queries/tasks';
import type { Project } from '@/domain/project';
import type { Task } from '@/domain/task';
import { cn } from '@/lib/cn';
import { createTask, updateTask } from '@/db/tasks';
import { listLabels, toggleTaskLabel } from '@/db/labels';
import { listSubtaskRelationsForProject } from '@/db/relations';
import { subscribe } from '@/db/bus';
import { Trash2, Plus, Loader2, Pencil, RefreshCw, Paperclip, ChevronRight, CheckSquare, Square } from 'lucide-react';
import { useTaskLabels } from '@/queries/taskLabels';
import { useTasksWithAttachments } from '@/queries/attachments';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { LabelChips } from './LabelChips';
import { QuickAddPreview } from './QuickAddPreview';
import type { TaskInput } from '@/domain/task';
import { parseQuickAdd } from '@/lib/quickAddParser';


interface TaskListProps {
  project: Project;
}

export function TaskList({ project }: TaskListProps) {
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
  const { data: attachmentIds } = useTasksWithAttachments();
  const qc = useQueryClient();

  const { data: subtaskMap = new Map() } = useQuery({
    queryKey: ['subtasks', project.localId],
    queryFn: () => listSubtaskRelationsForProject(project.localId),
    staleTime: 30_000,
  });

  useEffect(() => subscribe('tasks', () => {
    qc.invalidateQueries({ queryKey: ['subtasks', project.localId] });
  }), [qc, project.localId]);

  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const taskTree = useMemo(
    () => buildTaskTree(visibleTasks, subtaskMap),
    [visibleTasks, subtaskMap],
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
      const input: TaskInput = {
        title: parsed.title || newTitle.trim(),
        projectLocalId: project.localId,
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.priority !== null ? { priority: parsed.priority } : {}),
        ...(parsed.repeatAfter ? { repeatAfter: parsed.repeatAfter, repeatMode: parsed.repeatMode } : {}),
        ...metadata,
      };

      const created = await createTask(input);

      // Apply parsed #labels. We look up by case-insensitive title in
      // the local catalogue; labels that don't exist yet are silently
      // skipped (M5+ will offer create-as-you-type via the picker).
      if (parsed.labelTitles.length > 0 && created.localId) {
        try {
          const all = await listLabels();
          const lookup = new Map(all.map((l) => [l.title.toLowerCase(), l.localId]));
          for (const t of parsed.labelTitles) {
            const id = lookup.get(t.toLowerCase());
            if (id) await toggleTaskLabel(created.localId, id);
          }
        } catch (err) {
          console.warn('[quick-add] label application failed:', err);
        }
      }

      // Assignee resolution requires a local users table we don't keep
      // yet. Surface a warning instead of dropping silently so the user
      // knows why @alice didn't stick. M8 wires assignee creation
      // properly.
      if (parsed.assigneeUsernames.length > 0) {
        console.info(
          '[quick-add] @assignee tokens are parsed but not yet applied:',
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
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-muted-foreground)]">
        <span>
          {visibleTasks.length === 0
            ? isLoading
              ? 'Loading…'
              : 'No tasks'
            : `${visibleTasks.length} task${visibleTasks.length === 1 ? '' : 's'}`}
        </span>
        {isFetching ? <span aria-live="polite">syncing…</span> : null}
      </div>

      {/* Inline create — natural-language parsing on the title field
          (tomorrow / #label / !priority / @assignee). Explicit date +
          priority controls stay for users who'd rather not type the
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
            placeholder="Add a task… e.g. Buy milk tomorrow #shopping !2"
            disabled={isSubmitting}
            className="flex-1 bg-transparent text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none disabled:opacity-50"
          />
        </div>
        {/* Secondary row: explicit date + priority pickers. They override
            the NL-parsed values when touched, but live below the title so
            they don't crowd the primary input (issue #19). `pl-7` aligns
            them under the title input, past the plus-icon column. */}
        <div className="mt-2 flex items-center gap-3 pl-7 text-[var(--color-muted-foreground)]">
          <input
            type="date"
            onChange={(e) =>
              setMetadata({ ...metadata, dueDate: e.target.value || null })
            }
            className="text-xs"
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

      <ul className="flex-1 overflow-y-auto">
        {taskTree.map((node) => (
          <TreeBranch
            key={node.task.localId}
            node={node}
            depth={0}
            expandedSet={expandedSet}
            onToggle={toggleExpand}
            attachmentIds={attachmentIds}
          />
        ))}
      </ul>

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
  const childSet = new Set<string>();
  for (const [, children] of parentMap) {
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
  expandedSet,
  onToggle,
  attachmentIds,
}: {
  node: TaskTreeNode;
  depth: number;
  expandedSet: Set<string>;
  onToggle: (id: string) => void;
  attachmentIds: Set<string> | undefined;
}) {
  const isExpanded = expandedSet.has(node.task.localId);
  return (
    <>
      <TaskRow
        task={node.task}
        hasAttachments={attachmentIds?.has(node.task.localId) ?? false}
        depth={depth}
        hasChildren={node.children.length > 0}
        expanded={isExpanded}
        onToggleChildren={() => onToggle(node.task.localId)}
      />
      {isExpanded &&
        node.children.map((child) => (
          <TreeBranch
            key={child.task.localId}
            node={child}
            depth={depth + 1}
            expandedSet={expandedSet}
            onToggle={onToggle}
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
  hasChildren = false,
  expanded = false,
  onToggleChildren,
}: {
  task: Task;
  hasAttachments: boolean;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleChildren?: () => void;
}) {
  const selectedTaskId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { data: labels = [] } = useTaskLabels(task.localId);
  const enqueueDelete = usePendingDeletes((s) => s.enqueue);
  const checklist = countChecklistItems(task.description);

  const handleToggle = async () => {
    try {
      await updateTask(task.localId, { done: !task.done });
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
      data-task-row=""
      className={cn(
        'group flex items-start gap-3 border-b border-[var(--color-border)] py-3 transition-colors hover:bg-[var(--color-accent)]/5',
        'px-6',
        task.done && 'opacity-60',
        selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10'
      )}
      style={{ paddingLeft: `${24 + depth * 20}px` }}
      onClick={() => { if (!editing) setSelectedTask(task.localId); }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleChildren?.();
          }}
          aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          className="mt-1 h-4 w-4 shrink-0 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
      ) : depth > 0 ? (
        <span className="mt-1 h-4 w-4 shrink-0" />
      ) : null}
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
    return format(new Date(iso), 'd MMM');
  } catch {
    return iso;
  }
}
