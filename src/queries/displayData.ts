import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { startOfDay } from 'date-fns';
import { listAllTaskLabelLinks } from '@/db/labels';
import { listAllTaskAssignees } from '@/db/task-assignees';
import { subscribe } from '@/db/bus';
import { useLabels } from '@/queries/labels';
import { useCurrentUser } from '@/queries/user';
import type { DisplayCtx } from '@/lib/displayConfig';

/** task localId → label localIds, across all projects (smart-view filters). */
export function useAllTaskLabels() {
  const qc = useQueryClient();
  useEffect(() => {
    const inval = () => void qc.invalidateQueries({ queryKey: ['all-task-labels'] });
    const a = subscribe('tasks', inval);
    const b = subscribe('task_labels', inval);
    return () => {
      a();
      b();
    };
  }, [qc]);
  return useQuery<Map<string, string[]>>({
    queryKey: ['all-task-labels'],
    queryFn: () => listAllTaskLabelLinks(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** task localId → assignee user server ids, across all projects. */
export function useAllTaskAssignees() {
  const qc = useQueryClient();
  useEffect(() => {
    const inval = () => void qc.invalidateQueries({ queryKey: ['all-task-assignees'] });
    const a = subscribe('tasks', inval);
    const b = subscribe('task_assignees', inval);
    return () => {
      a();
      b();
    };
  }, [qc]);
  return useQuery<Map<string, number[]>>({
    queryKey: ['all-task-assignees'],
    queryFn: () => listAllTaskAssignees(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Assembles the DisplayCtx the `applyDisplay` transform needs (label/assignee
 * maps + current user + today). `today` is memoised to the calendar day so it
 * stays stable across renders within a day.
 */
export function useDisplayCtx(): DisplayCtx {
  const { data: labelsByTask } = useAllTaskLabels();
  const { data: assigneesByTask } = useAllTaskAssignees();
  const { data: labels = [] } = useLabels();
  const { data: user } = useCurrentUser();

  const labelTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of labels) m.set(l.localId, l.title);
    return m;
  }, [labels]);

  // Pin to the calendar day so memo identity is stable between renders.
  const todayKey = startOfDay(new Date()).getTime();
  const today = useMemo(() => new Date(todayKey), [todayKey]);

  return useMemo(
    () => ({
      labelsByTask: labelsByTask ?? new Map(),
      labelTitleById,
      assigneesByTask: assigneesByTask ?? new Map(),
      currentUserId: user?.serverId ?? null,
      today,
    }),
    [labelsByTask, assigneesByTask, labelTitleById, user?.serverId, today],
  );
}
