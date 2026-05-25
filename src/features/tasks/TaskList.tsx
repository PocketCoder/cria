import { useState } from 'react';
import { useUi } from '@/stores/ui';
import { format } from 'date-fns';
import { useProjectTasks } from '@/queries/tasks';
import type { Project } from '@/domain/project';
import type { Task } from '@/domain/task';
import { cn } from '@/lib/cn';
import { createTask, updateTask, deleteTask } from '@/db/tasks';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import { useTaskLabels } from '@/queries/taskLabels';
import { LabelChips } from './LabelChips';
import type { TaskInput } from '@/domain/task';

interface TaskListProps {
  project: Project;
}

export function TaskList({ project }: TaskListProps) {
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project);

  const [newTitle, setNewTitle] = useState('');
  const [metadata, setMetadata] = useState<Partial<TaskInput>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await createTask({
        title: newTitle.trim(),
        projectLocalId: project.localId,
        ...metadata,
      });
      setNewTitle('');
       setMetadata({});
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-muted-foreground)]">
        <span>
          {tasks.length === 0
            ? isLoading
              ? 'Loading…'
              : 'No tasks'
            : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
        </span>
        {isFetching ? <span aria-live="polite">syncing…</span> : null}
      </div>

      {/* Sleek Inline Create Task Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-3 border-b border-[var(--color-border)] px-6 py-3"
      >
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
           placeholder="Add a task…"
           disabled={isSubmitting}
           className="flex-1 bg-transparent text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none disabled:opacity-50"
        />
        <input type="date" onChange={(e)=>setMetadata({...metadata,dueDate:e.target.value})} className="text-xs" />
        <select onChange={(e)=>setMetadata({...metadata,priority:Number(e.target.value)})} className="text-xs">
          <option value="0">Priority 0</option>
          <option value="1">Priority 1</option>
          <option value="2">Priority 2</option>
          <option value="3">Priority 3</option>
          <option value="4">Priority 4</option>
          <option value="5">Priority 5</option>
        </select>
      </form>

      <ul className="flex-1 overflow-y-auto">
        {tasks.map((t) => (
          <TaskRow key={t.localId} task={t} />
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

function TaskRow({ task }: { task: Task }) {
  const selectedTaskId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const { data: labels = [] } = useTaskLabels(task.localId);

  const handleToggle = async () => {
    try {
      await updateTask(task.localId, { done: !task.done });
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    try {
      setIsDeleting(true);
      await deleteTask(task.localId);
    } catch (err) {
      console.error('Failed to delete task:', err);
      setIsDeleting(false);
    }
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
      className={cn(
        'group flex items-start gap-3 border-b border-[var(--color-border)] px-6 py-3 transition-colors hover:bg-[var(--color-accent)]/5',
        task.done && 'opacity-60',
        isDeleting && 'opacity-30 pointer-events-none',
        selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10'
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
          <p
            className={cn(
              'cursor-pointer truncate rounded px-1 py-0.5 text-sm transition-all hover:bg-[var(--color-muted)]',
              task.done && 'line-through text-[var(--color-muted-foreground)]',
            )}
            onClick={handleTitleEdit}
            title={task.title}
          >
            {task.title}
          </p>
        )}
        {task.dueDate || task.priority > 0 ? (
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-muted-foreground)]">
            {task.dueDate ? (
              <span>Due {formatDate(task.dueDate)}</span>
            ) : null}
            {task.priority > 0 ? (
              <span aria-label={`Priority ${task.priority}`}>
                {'!'.repeat(Math.min(5, task.priority))}
              </span>
            ) : null}
          </p>
        ) : null}
        {labels.length > 0 ? (
          <div className="mt-1">
            <LabelChips labels={labels} />
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
      <button
        onClick={handleDelete}
        aria-label="Delete task"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -m-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-warning)] cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
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
