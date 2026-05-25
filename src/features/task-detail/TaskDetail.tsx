import { useUi } from '@/stores/ui';
import { useQuery } from '@tanstack/react-query';
import { getDb } from '@/db';
import { format } from 'date-fns';


/** Read‑only detail view for the currently selected task */
export function TaskDetail() {
  const selectedId = useUi((s) => s.selectedTaskLocalId);

  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task', selectedId],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<any[]>(
        `SELECT * FROM tasks WHERE local_id = ?`,
        [selectedId]
      );
      return rows[0] ?? null;
    },
    enabled: !!selectedId,
  });

  if (!selectedId) {
    return (
      <section className="flex min-w-0 flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">Select a task to see details.</p>
      </section>
    );
  }

  if (isLoading) {
    return <div className="p-4">Loading…</div>;
  }

  if (isError || !task) {
    return (
      <div className="p-4 text-[var(--color-warning)]">
        Could not load task details.
      </div>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-muted)] p-6">
      <h2 className="text-lg font-semibold mb-2">{task.title}</h2>
      {task.description && (
        <div className="mb-4 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: task.description }} />
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm text-[var(--color-muted-foreground)]">
        {task.dueDate && (
          <>
            <dt>Due</dt>
            <dd>{format(new Date(task.dueDate), 'd MMM yyyy')}</dd>
          </>
        )}
        {task.priority > 0 && (
          <>
            <dt>Priority</dt>
            <dd>{'!'.repeat(Math.min(5, task.priority))}</dd>
          </>
        )}
        {task.hexColor && (
          <>
            <dt>Color</dt>
            <dd>
              <span
                className="inline-block h-4 w-4 rounded"
                style={{ background: task.hexColor }}
              />
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
