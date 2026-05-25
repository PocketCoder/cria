import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUi } from '@/stores/ui';
import { getTaskByLocalId, updateTask } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { useTaskLabels } from '@/queries/taskLabels';
import { LabelChips } from '@/features/tasks/LabelChips';
import { RichTextEditor } from './RichTextEditor';
import { TaskActions } from './TaskActions';
import type { Task } from '@/domain/task';

export function TaskDetail() {
  const selectedId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
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

  const handleDeleted = () => {
    setSelectedTask(null);
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-muted)]">
      <div className="flex-1 p-5">
        <h2 className="mb-2 text-base font-semibold leading-tight">{task.title}</h2>

        {labels.length > 0 ? (
          <div className="mb-3">
            <LabelChips labels={labels} />
          </div>
        ) : null}

        <section className="mb-4">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Description
          </h3>
          <RichTextEditor
            value={task.description}
            onSave={handleDescriptionSave}
          />
        </section>

        <div className="space-y-1">
          <TaskActions task={task} onDeleted={handleDeleted} />
        </div>
      </div>
    </aside>
  );
}
