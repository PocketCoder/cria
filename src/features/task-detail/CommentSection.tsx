import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { useTaskComments, useTaskUnreadCount } from '@/queries/comments';
import { markCommentsAsRead } from '@/db/comments';
import { sanitizeHtml } from '@/lib/sanitize';
import type { TaskComment } from '@/db/comments';

export function CommentSection({
  taskLocalId,
}: {
  taskLocalId: string;
}) {
  const { data: comments = [] } = useTaskComments(taskLocalId);
  const { data: unreadCount = 0 } = useTaskUnreadCount(taskLocalId);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const totalCount = comments.length;

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
  };

  useEffect(() => {
    if (expanded && unreadCount > 0) {
      void markCommentsAsRead(taskLocalId).then(() => {
        void qc.invalidateQueries({ queryKey: ['comments', taskLocalId] });
        void qc.invalidateQueries({ queryKey: ['comments', 'unread', taskLocalId] });
      });
    }
  }, [expanded, unreadCount, taskLocalId, qc]);

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
          {comments.length === 0 ? (
            <p className="px-1 text-xs text-[var(--color-muted-foreground)]">
              No comments yet.
            </p>
          ) : (
            comments.map((c) => (
              <CommentRow key={c.localId} comment={c} />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function CommentRow({ comment }: { comment: TaskComment }) {
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

  const timeAgo = useMemo(() => formatTimeAgo(comment.createdAt), [comment.createdAt]);

  return (
    <div
      className={`rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs ${!comment.read ? 'border-l-2 border-l-[var(--color-primary)]' : ''}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted-foreground)] text-[9px] font-medium text-white">
          {initials}
        </div>
        <span className="font-medium text-[var(--color-foreground)]">
          {comment.authorName ?? 'Unknown'}
        </span>
        {timeAgo ? (
          <span className="text-[var(--color-muted-foreground)]">{timeAgo}</span>
        ) : null}
      </div>
      <div
        className="prose prose-sm max-w-none break-words text-xs leading-relaxed text-[var(--color-foreground)] [&_a]:underline [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-2 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-[10px] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment.comment) }}
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
  // Fallback to date string
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
