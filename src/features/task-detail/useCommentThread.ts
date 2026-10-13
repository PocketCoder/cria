import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTaskComments, useTaskUnreadCount } from '@/queries/comments';
import {
  markCommentsAsRead,
  createComment,
  updateComment,
  deleteComment,
  type TaskComment,
} from '@/db/comments';
import { getCachedUser } from '@/db/user';
import { getAuthSnapshot } from '@/auth/store';
import { pullCommentsForTask } from '@/sync/pull';
import { commentPermalink, sortComments } from './commentLogic';

/** Data, sync side effects and write actions behind a task's comment thread. */
export function useCommentThread(
  taskLocalId: string,
  taskServerId: number | null,
  initiallyExpanded: boolean,
) {
  const { data: comments = [] } = useTaskComments(taskLocalId);
  const { data: unreadCount = 0 } = useTaskUnreadCount(taskLocalId);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [sortAsc, setSortAsc] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  useEffect(() => {
    getCachedUser().then((user) => setCurrentUserId(user?.serverId ?? null));
  }, []);

  // Refresh server comments whenever the detail opens for a task. The bulk
  // list pulls dropped `expand: 'comments'`, so comments no longer arrive
  // inline — pull just this task's comments here (lighter than refetching the
  // whole task, and it won't clobber other relations). Best-effort: it
  // resolves the server id itself and swallows its own errors.
  useEffect(() => {
    void pullCommentsForTask(taskLocalId);
  }, [taskLocalId]);

  const sortedComments = useMemo(() => sortComments(comments, sortAsc), [comments, sortAsc]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['comments', taskLocalId] });
    void qc.invalidateQueries({ queryKey: ['comments', 'unread', taskLocalId] });
  }, [qc, taskLocalId]);

  useEffect(() => {
    if (expanded && unreadCount > 0) {
      void markCommentsAsRead(taskLocalId).then(invalidate);
    }
  }, [expanded, unreadCount, taskLocalId, invalidate]);

  const create = useCallback(
    async (html: string) => {
      if (!html.trim()) return;
      await createComment(taskLocalId, html);
      invalidate();
    },
    [taskLocalId, invalidate],
  );

  const update = useCallback(
    async (commentLocalId: string, html: string) => {
      if (!html.trim()) return;
      await updateComment(commentLocalId, html);
      setEditingId(null);
      invalidate();
    },
    [invalidate],
  );

  const remove = useCallback(
    async (commentLocalId: string) => {
      await deleteComment(commentLocalId);
      setDeletingId(null);
      invalidate();
    },
    [invalidate],
  );

  const copyPermalink = useCallback(
    (comment: TaskComment) => {
      const { serverUrl } = getAuthSnapshot();
      void navigator.clipboard.writeText(commentPermalink({ serverUrl, taskServerId, comment }));
      setCopiedId(comment.localId);
      setTimeout(() => setCopiedId(null), 1500);
    },
    [taskServerId],
  );

  return {
    comments,
    sortedComments,
    unreadCount,
    expanded,
    setExpanded,
    sortAsc,
    setSortAsc,
    editingId,
    setEditingId,
    deletingId,
    setDeletingId,
    copiedId,
    currentUserId,
    create,
    update,
    remove,
    copyPermalink,
  };
}
