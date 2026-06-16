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
    () => {
      const unsub1 = subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['comments'] });
      });
      const unsub2 = subscribe('comments', () => {
        void qc.invalidateQueries({ queryKey: ['comments'] });
      });
      return () => { unsub1(); unsub2(); };
    },
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
    () => {
      const unsub1 = subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['comments', 'unread'] });
      });
      const unsub2 = subscribe('comments', () => {
        void qc.invalidateQueries({ queryKey: ['comments', 'unread'] });
      });
      return () => { unsub1(); unsub2(); };
    },
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
