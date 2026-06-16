import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCommentsForTask,
  getUnreadCountForTask,
  type TaskComment,
} from '@/db/comments';
import { subscribe } from '@/db/bus';

export function useTaskComments(taskLocalId: string | null) {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['comments'] });
      }),
    [qc],
  );
  return useQuery<TaskComment[]>({
    queryKey: ['comments', taskLocalId],
    enabled: !!taskLocalId,
    staleTime: 30_000,
    queryFn: async () =>
      taskLocalId ? listCommentsForTask(taskLocalId) : [],
  });
}

export function useTaskUnreadCount(taskLocalId: string | null) {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['comments', 'unread'] });
      }),
    [qc],
  );
  return useQuery<number>({
    queryKey: ['comments', 'unread', taskLocalId],
    enabled: !!taskLocalId,
    staleTime: 30_000,
    queryFn: async () =>
      taskLocalId ? getUnreadCountForTask(taskLocalId) : 0,
  });
}
