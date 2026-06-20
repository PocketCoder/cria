import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  ArrowUpDown,
  Pencil,
  Trash2,
  Link,
  Check,
  Plus,
} from 'lucide-react';
import { useTaskComments, useTaskUnreadCount } from '@/queries/comments';
import {
  markCommentsAsRead,
  createComment,
  updateComment,
  deleteComment,
  toggleCommentReaction,
  type TaskComment,
} from '@/db/comments';
import { getCachedUser } from '@/db/user';
import { sanitizeHtml } from '@/lib/sanitize';
import { getAuthSnapshot } from '@/auth/store';
import { pullCommentsForTask } from '@/sync/pull';
import { RichTextEditor } from './RichTextEditor';

export function CommentSection({
  taskLocalId,
  taskServerId,
}: {
  taskLocalId: string;
  taskServerId: number | null;
}) {
  const { data: comments = [] } = useTaskComments(taskLocalId);
  const { data: unreadCount = 0 } = useTaskUnreadCount(taskLocalId);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
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

  const totalCount = comments.length;

  const sortedComments = useMemo(() => {
    const sorted = [...comments];
    sorted.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return sortAsc ? aTime - bTime : bTime - aTime;
    });
    return sorted;
  }, [comments, sortAsc]);

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  useEffect(() => {
    if (expanded && unreadCount > 0) {
      void markCommentsAsRead(taskLocalId).then(() => {
        void qc.invalidateQueries({ queryKey: ['comments', taskLocalId] });
        void qc.invalidateQueries({ queryKey: ['comments', 'unread', taskLocalId] });
      });
    }
  }, [expanded, unreadCount, taskLocalId, qc]);

  const handleCreateComment = useCallback(
    async (html: string) => {
      if (!html.trim()) return;
      await createComment(taskLocalId, html);
      void qc.invalidateQueries({ queryKey: ['comments', taskLocalId] });
      void qc.invalidateQueries({ queryKey: ['comments', 'unread', taskLocalId] });
    },
    [taskLocalId, qc],
  );

  const handleUpdateComment = useCallback(
    async (commentLocalId: string, html: string) => {
      if (!html.trim()) return;
      await updateComment(commentLocalId, html);
      setEditingCommentId(null);
      void qc.invalidateQueries({ queryKey: ['comments', taskLocalId] });
      void qc.invalidateQueries({ queryKey: ['comments', 'unread', taskLocalId] });
    },
    [taskLocalId, qc],
  );

  const handleDeleteComment = useCallback(
    async (commentLocalId: string) => {
      await deleteComment(commentLocalId);
      setDeletingCommentId(null);
      void qc.invalidateQueries({ queryKey: ['comments', taskLocalId] });
      void qc.invalidateQueries({ queryKey: ['comments', 'unread', taskLocalId] });
    },
    [taskLocalId, qc],
  );

  const handleCopyPermalink = useCallback(
    (comment: TaskComment) => {
      const { serverUrl } = getAuthSnapshot();
      let text: string;
      if (serverUrl && taskServerId && comment.serverId) {
        text = `${serverUrl.replace(/\/+$/, '')}/tasks/${taskServerId}#comment-${comment.serverId}`;
      } else if (comment.serverId) {
        text = `#comment-${comment.serverId}`;
      } else {
        text = `comment by ${comment.authorName ?? 'Unknown'} at ${comment.createdAt ?? ''}`;
      }
      void navigator.clipboard.writeText(text);
      setCopiedId(comment.localId);
      setTimeout(() => setCopiedId(null), 1500);
    },
    [taskServerId],
  );

  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <MessageSquare className="h-3 w-3" />
        Comments
        {totalCount > 0 ? (
          <span className="font-normal">{totalCount}</span>
        ) : null}
        {unreadCount > 0 ? (
          <span className="ml-auto rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[9px] font-normal text-white">
            {unreadCount} new
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2">
          {comments.length > 1 ? (
            <button
              type="button"
              onClick={() => setSortAsc(!sortAsc)}
              className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortAsc ? 'Oldest first' : 'Newest first'}
            </button>
          ) : null}

          {sortedComments.length === 0 ? (
            <p className="px-1 text-xs text-[var(--color-muted-foreground)]">
              No comments yet.
            </p>
          ) : (
            sortedComments.map((c) => (
              <CommentRow
                key={c.localId}
                comment={c}
                isEditing={editingCommentId === c.localId}
                isDeleting={deletingCommentId === c.localId}
                isCopied={copiedId === c.localId}
                taskServerId={taskServerId}
                currentUserId={currentUserId}
                onEdit={() => setEditingCommentId(c.localId)}
                onCancelEdit={() => setEditingCommentId(null)}
                onSave={(html) => handleUpdateComment(c.localId, html)}
                onDelete={() => setDeletingCommentId(c.localId)}
                onConfirmDelete={() => handleDeleteComment(c.localId)}
                onCancelDelete={() => setDeletingCommentId(null)}
                onCopyPermalink={() => handleCopyPermalink(c)}
              />
            ))
          )}

          <CommentCreateForm
            onSave={handleCreateComment}
            taskLocalId={taskLocalId}
            taskServerId={taskServerId}
          />
        </div>
      ) : null}
    </section>
  );
}

function CommentRow({
  comment,
  isEditing,
  isDeleting,
  isCopied,
  taskServerId,
  currentUserId,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onCopyPermalink,
}: {
  comment: TaskComment;
  isEditing: boolean;
  isDeleting: boolean;
  isCopied: boolean;
  taskServerId: number | null;
  currentUserId: number | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (html: string) => Promise<void>;
  onDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
  onCopyPermalink: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const initials = useMemo(() => {
    const name = comment.authorName;
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const first = parts[0] ?? '';
    const last = parts[parts.length - 1] ?? '';
    if (parts.length >= 2 && first && last) {
      return (first.charAt(0) + last.charAt(0)).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }, [comment.authorName]);

  const avatarFill = useMemo(() => {
    let hash = 0;
    const name = comment.authorName ?? '';
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 55%, 50%)`;
  }, [comment.authorName]);

  const timeAgo = useMemo(() => formatTimeAgo(comment.createdAt), [comment.createdAt]);
  const isEdited = comment.updatedAt && comment.createdAt && comment.updatedAt !== comment.createdAt;

  if (isDeleting) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-foreground)]">
            Delete this comment?
          </span>
          <button
            type="button"
            onClick={() => void onConfirmDelete()}
            className="cursor-pointer rounded bg-[var(--color-destructive)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2">
        <RichTextEditor
          value={comment.comment}
          autoEdit
          onSave={onSave}
          taskLocalId={comment.taskLocalId}
          taskServerId={taskServerId}
        />
        <button
          type="button"
          onClick={onCancelEdit}
          className="mt-1 cursor-pointer text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          Cancel editing
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs ${!comment.read ? 'border-l-2 border-l-[var(--color-primary)]' : ''}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <svg
          viewBox="0 0 32 32"
          className="h-5 w-5 shrink-0 rounded-full"
          aria-hidden="true"
        >
          <circle cx="16" cy="16" r="16" fill={avatarFill} />
          <text
            x="16"
            y="16"
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="12"
            fontFamily="system-ui, sans-serif"
            fontWeight="600"
          >
            {initials}
          </text>
        </svg>
        <span className="font-medium text-[var(--color-foreground)]">
          {comment.authorName ?? 'Unknown'}
        </span>
        {timeAgo ? (
          <span className="text-[var(--color-muted-foreground)]">{timeAgo}</span>
        ) : null}
        {isEdited ? (
          <span className="italic text-[var(--color-muted-foreground)]">(edited)</span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={onCopyPermalink}
            className="cursor-pointer rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
            title="Copy comment link"
          >
            {isCopied ? (
              <Check className="h-3 w-3 text-[var(--color-primary)]" />
            ) : (
              <Link className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="cursor-pointer rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
            title="Edit comment"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="cursor-pointer rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-muted)]"
            title="Delete comment"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div
        className="prose prose-sm max-w-none break-words text-xs leading-relaxed text-[var(--color-foreground)] [&_a]:underline [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-2 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-[10px] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment.comment) }}
      />

      {comment.deleted ? null : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {Object.entries(comment.reactions ?? {}).map(([emoji, users]) => {
            if (users.length === 0) return null;
            const active = currentUserId !== null && users.some((u) => u.id === currentUserId);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => toggleCommentReaction(comment.localId, emoji)}
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] leading-none cursor-pointer transition-colors ${
                  active
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                    : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/80'
                }`}
              >
                <span>{emoji}</span>
                <span className="tabular-nums">{users.length}</span>
              </button>
            );
          })}

          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen(!pickerOpen)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-muted)] text-xs leading-none text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/80 hover:text-[var(--color-foreground)] cursor-pointer transition-colors"
              title="Add reaction"
            >
              +
            </button>

            {pickerOpen ? (
              <div className="absolute bottom-full left-0 mb-1 flex gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1 shadow-md z-10">
                {['👍', '🎉', '❤️', '😄', '🚀', '👀'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      toggleCommentReaction(comment.localId, emoji);
                      setPickerOpen(false);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded text-sm hover:bg-[var(--color-muted)] cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function CommentCreateForm({
  onSave,
  taskLocalId,
  taskServerId,
}: {
  onSave: (html: string) => Promise<void>;
  taskLocalId: string;
  taskServerId: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] p-3 text-left text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        Write a comment…
      </button>
    );
  }

  return (
    <div className="mt-3">
      <RichTextEditor
        key={`comment-create-${createKey}`}
        value=""
        autoEdit
        onSave={async (html) => {
          await onSave(html);
          setCreateKey((k) => k + 1);
          setOpen(false);
        }}
        taskLocalId={taskLocalId}
        taskServerId={taskServerId}
      />
    </div>
  );
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
