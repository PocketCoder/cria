import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { startOfDay, isBefore, isSameDay, addDays, format } from 'date-fns';
import {
  listTasksWithDueDate,
  listTasksForLabel,
  listFavoriteTasks,
  listTasksForProject,
  type TaskWithProject,
} from '@/db/tasks';
import { getDb } from '@/db';
import { useCurrentUser } from '@/queries/user';
import { subscribe } from '@/db/bus';

export interface TaskGroup {
  key: string;
  label: string;
  tasks: TaskWithProject[];
}

export function groupTotal(groups: TaskGroup[]): number {
  return groups.reduce((n, g) => n + g.tasks.length, 0);
}

/** Bucket a flat task list into one group per project (using its title
 * as both key and label). Preserves first-seen project order, matching
 * the order the underlying query returned. */
function groupByProject(tasks: TaskWithProject[]): TaskGroup[] {
  const byProject = new Map<string, TaskWithProject[]>();
  for (const t of tasks) {
    const arr = byProject.get(t.projectTitle) ?? [];
    arr.push(t);
    byProject.set(t.projectTitle, arr);
  }
  return [...byProject.entries()].map(([title, group]) => ({
    key: title,
    label: title,
    tasks: group,
  }));
}

/** Today = overdue (surfaced first) + due-today, across all projects. */
export function useTodayTasks() {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['smart', 'today'] });
      }),
    [qc],
  );

  return useQuery<TaskGroup[]>({
    queryKey: ['smart', 'today'],
    staleTime: 30_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const all = await listTasksWithDueDate();
      const today = startOfDay(new Date());
      const overdue: TaskWithProject[] = [];
      const due: TaskWithProject[] = [];
      for (const t of all) {
        if (!t.dueDate) continue;
        const d = startOfDay(new Date(t.dueDate));
        if (isBefore(d, today)) overdue.push(t);
        else if (isSameDay(d, today)) due.push(t);
      }
      const groups: TaskGroup[] = [];
      if (overdue.length) {
        groups.push({ key: 'overdue', label: 'Overdue', tasks: overdue });
      }
      groups.push({ key: 'today', label: 'Today', tasks: due });
      return groups;
    },
  });
}

/** Upcoming = next 7 days, one group per day that has tasks. */
export function useUpcomingTasks() {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['smart', 'upcoming'] });
      }),
    [qc],
  );

  return useQuery<TaskGroup[]>({
    queryKey: ['smart', 'upcoming'],
    staleTime: 30_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const all = await listTasksWithDueDate();
      const today = startOfDay(new Date());
      const groups: TaskGroup[] = [];
      for (let i = 1; i <= 7; i++) {
        const day = addDays(today, i);
        const tasks = all.filter(
          (t) => t.dueDate && isSameDay(startOfDay(new Date(t.dueDate)), day),
        );
        if (tasks.length === 0) continue;
        groups.push({
          key: format(day, 'yyyy-MM-dd'),
          label: i === 1 ? 'Tomorrow' : format(day, 'EEEE d MMM'),
          tasks,
        });
      }
      return groups;
    },
  });
}

/** A single label's tasks, grouped by project. */
export function useLabelTasks(labelLocalId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    const inval = () =>
      void qc.invalidateQueries({ queryKey: ['smart', 'label'] });
    const un1 = subscribe('tasks', inval);
    const un2 = subscribe('task_labels', inval);
    return () => {
      un1();
      un2();
    };
  }, [qc]);

  return useQuery<TaskGroup[]>({
    queryKey: ['smart', 'label', labelLocalId],
    enabled: !!labelLocalId,
    staleTime: 30_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!labelLocalId) return [];
      return groupByProject(await listTasksForLabel(labelLocalId));
    },
  });
}

/** Tasks in the user's default inbox project, grouped by project. */
export function useInboxTasks() {
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['smart', 'inbox'] });
      }),
    [qc],
  );

  return useQuery<TaskGroup[]>({
    queryKey: ['smart', 'inbox'],
    enabled: !!user?.defaultProjectId,
    staleTime: 30_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!user?.defaultProjectId) return [];
      const db = await getDb();
      const rows = await db.select<{ local_id: string; title: string }[]>(
        `SELECT local_id, title FROM projects WHERE server_id = ? LIMIT 1`,
        [user.defaultProjectId],
      );
      const project = rows[0];
      if (!project) return [];
      const tasks = await listTasksForProject(project.local_id);
      const withProject: TaskWithProject[] = tasks.map((t) => ({
        ...t,
        projectTitle: project.title,
      }));
      return [{ key: 'inbox', label: project.title, tasks: withProject }];
    },
  });
}

/** Favorited tasks, grouped by project. */
export function useFavoriteTasks() {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['smart', 'favorites'] });
      }),
    [qc],
  );

  return useQuery<TaskGroup[]>({
    queryKey: ['smart', 'favorites'],
    staleTime: 30_000,
    refetchInterval: 15_000,
    queryFn: async () => groupByProject(await listFavoriteTasks()),
  });
}
