import { format } from 'date-fns';
import { useProjectTasks } from '@/queries/tasks';
import type { Project } from '@/domain/project';
import type { Task } from '@/domain/task';
import { cn } from '@/lib/cn';

interface TaskListProps {
  project: Project;
}

export function TaskList({ project }: TaskListProps) {
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project);

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
  return (
    <li
      className={cn(
        'flex items-start gap-3 border-b border-[var(--color-border)] px-6 py-3',
        task.done && 'opacity-60',
      )}
    >
      <input
        type="checkbox"
        checked={task.done}
        readOnly
        aria-label={task.done ? 'Done' : 'Not done'}
        className="mt-1 h-4 w-4 cursor-default accent-[var(--color-primary)]"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm',
            task.done && 'line-through',
          )}
          title={task.title}
        >
          {task.title}
        </p>
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
      </div>
      {task.hexColor ? (
        <span
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: task.hexColor }}
        />
      ) : null}
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
