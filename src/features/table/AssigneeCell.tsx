import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listAssigneesForTask } from '@/db/task-assignees';
import { subscribe } from '@/db/bus';
import type { TaskAssignee } from '@/domain/task-assignee';

/**
 * Per-task assignee query. Refreshes on `tasks` (a pull mirrors assignees
 * inline) and `task_assignees` (local add/remove), mirroring how
 * useTaskLabels observes its topics.
 */
function useTaskAssignees(taskLocalId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const inval = () =>
      void queryClient.invalidateQueries({ queryKey: ['task-assignees'] });
    const unsubTasks = subscribe('tasks', inval);
    const unsubAssignees = subscribe('task_assignees', inval);
    return () => {
      unsubTasks();
      unsubAssignees();
    };
  }, [queryClient]);

  return useQuery<TaskAssignee[]>({
    queryKey: ['task-assignees', taskLocalId],
    queryFn: () => listAssigneesForTask(taskLocalId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

function initials(username: string | null): string {
  if (!username) return '?';
  const cleaned = username.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

/** Overlapping initial-avatars for a task's assignees. */
export function AssigneeCell({ taskLocalId }: { taskLocalId: string }) {
  const { data: assignees = [] } = useTaskAssignees(taskLocalId);
  if (assignees.length === 0) {
    return <span className="text-[var(--color-muted-foreground)]">—</span>;
  }
  return (
    <div className="flex -space-x-1.5">
      {assignees.map((a) => (
        <span
          key={a.userServerId}
          title={a.username ?? `User ${a.userServerId}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-card)] bg-[var(--color-muted)] text-micro font-medium text-[var(--color-foreground)]"
        >
          {initials(a.username)}
        </span>
      ))}
    </div>
  );
}
