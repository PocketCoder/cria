import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAttachmentsForTask,
  listTaskLocalIdsWithAttachments,
  type TaskAttachment,
} from '@/db/attachments';
import { subscribe } from '@/db/bus';

/** A single task's attachments, for the detail card list. */
export function useTaskAttachments(taskLocalId: string | null) {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['attachments'] });
      }),
    [qc],
  );
  return useQuery<TaskAttachment[]>({
    queryKey: ['attachments', taskLocalId],
    enabled: !!taskLocalId,
    staleTime: 30_000,
    queryFn: async () =>
      taskLocalId ? listAttachmentsForTask(taskLocalId) : [],
  });
}

/** Set of task local_ids that have ≥1 attachment, for the row paperclip.
 * One shared query (call once per list, pass `.has(id)` to rows). */
export function useTasksWithAttachments() {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['attachments', 'ids'] });
      }),
    [qc],
  );
  return useQuery<Set<string>>({
    queryKey: ['attachments', 'ids'],
    staleTime: 30_000,
    refetchInterval: 30_000, // catch attachments added by a background pull
    queryFn: async () => new Set(await listTaskLocalIdsWithAttachments()),
  });
}
