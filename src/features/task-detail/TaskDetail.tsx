import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useUi } from '@/stores/ui';
import { getTaskByLocalId, updateTask } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { useTaskLabels } from '@/queries/taskLabels';
import { LabelChips } from '@/features/tasks/LabelChips';
import { RichTextEditor } from './RichTextEditor';
import type { Task } from '@/domain/task';

/**
 * Read‑only task detail pane with editable description and expanded metadata.
 */
export function TaskDetail() {
  const selectedId = useUi((s) => s.selectedTaskLocalId);
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['task'] });
    });
  }, [queryClient]);

  const { data: task, isLoading, isError } = useQuery<Task | null>({
    queryKey: ['task', selectedId],
    queryFn: async () => (selectedId ? getTaskByLocalId(selectedId) : null),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const { data: labels = [] } = useTaskLabels(selectedId);

  if (!selectedId) {
    return (
      <aside className="flex w-80 shrink-0 items-center justify-center border-l border-[var(--color-border)] bg-[var(--color-muted)] p-6 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Select a task to see details.
        </p>
      </aside>
    );
  }

  if (isLoading) {
    return (
      <aside className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-muted)] p-6 text-sm text-[var(--color-muted-foreground)]">
        Loading…
      </aside>
    );
  }

  if (isError || !task) {
    return (
      <aside className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-muted)] p-6 text-sm text-[var(--color-warning)]">
        Could not load task details.
      </aside>
    );
  }

  const handleDescriptionSave = async (next: string) => {
    await updateTask(task.localId, { description: next });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-muted)] p-6">
      <h2 className="mb-3 text-base font-semibold leading-tight">{task.title}</h2>

      {labels.length > 0 ? (
        <div className="mb-4">
          <LabelChips labels={labels} />
        </div>
      ) : null}

      <section className="mb-5">
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          Description
        </h3>
        <RichTextEditor
          value={task.description}
          onSave={handleDescriptionSave}
        />
        </section>
        <details className="mb-5 border-t border-[var(--color-border)] pt-3">
          <summary className="text-xs font-semibold text-[var(--color-muted-foreground)]">Edit metadata</summary>
          <div className="pt-2 flex flex-col gap-2">
            <label className="text-xs text-[var(--color-muted-foreground)]">Due date</label>
            <input type="date" value={task.dueDate?.slice(0,10) ?? ''} onChange={e => updateTask(task.localId, { dueDate: e.target.value || null })} className="max-w-xs" />
            <label className="text-xs text-[var(--color-muted-foreground)]">Priority</label>
            <select value={task.priority} onChange={e => updateTask(task.localId, { priority: Number(e.target.value) })} className="max-w-xs">
              {[0,1,2,3,4,5].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </details>


      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
        {task.localId ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">ID</dt>
            <dd>{task.localId}</dd>
          </>
        ) : null}
        {task.serverId != null ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Server ID</dt>
            <dd>{task.serverId}</dd>
          </>
        ) : null}
        {task.done !== undefined ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Done</dt>
            <dd>{task.done ? 'Yes' : 'No'}</dd>
          </>
        ) : null}
        {task.doneAt ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Done At</dt>
            <dd>{safeFormat(task.doneAt)}</dd>
          </>
        ) : null}
        {task.updatedAt ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Updated</dt>
            <dd>{safeFormat(task.updatedAt)}</dd>
          </>
        ) : null}
        {task.dueDate ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Due</dt>
            <dd>{safeFormat(task.dueDate)}</dd>
          </>
        ) : null}
        {task.startDate ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Starts</dt>
            <dd>{safeFormat(task.startDate)}</dd>
          </>
        ) : null}
        {task.endDate ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Ends</dt>
            <dd>{safeFormat(task.endDate)}</dd>
          </>
        ) : null}
        {task.priority > 0 ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Priority</dt>
            <dd>{'!'.repeat(Math.min(5, task.priority))}</dd>
          </>
        ) : null}
        {task.percentDone > 0 ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Progress</dt>
            <dd>{Math.round(task.percentDone * 100)}%</dd>
          </>
        ) : null}
        {task.hexColor ? (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Colour</dt>
            <dd>
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: task.hexColor }}
              />
            </dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}

function safeFormat(iso: string): string {
  try {
    return format(new Date(iso), 'd MMM yyyy');
  } catch {
    return iso;
  }
}
