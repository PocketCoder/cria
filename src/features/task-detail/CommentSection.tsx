import { useMemo, useState } from 'react';
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
import { toggleCommentReaction, type TaskComment } from '@/db/comments';
import { RichTextEditor } from './RichTextEditor';
import { RichTextView } from './RichTextReadView';
import { ThreadSummary } from './ThreadSummary';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import type { MentionSearch } from './mentionExtension';
import { authorInitials, avatarFill, formatTimeAgo } from './commentLogic';
import { useCommentThread } from './useCommentThread';

export function CommentSection({
  taskLocalId,
  taskServerId,
  mentionSearch,
  hideHeader = false,
}: {
  taskLocalId: string;
  taskServerId: number | null;
  mentionSearch?: MentionSearch;
  hideHeader?: boolean;
}) {
  const t = useCommentThread(taskLocalId, taskServerId, hideHeader);
  const aiAvailable = useAiAvailable();

  return (
    <section className="mb-4">
      {hideHeader ? null : (
        <CommentsHeader
          expanded={t.expanded}
          total={t.comments.length}
          unread={t.unreadCount}
          onToggle={() => t.setExpanded(!t.expanded)}
        />
      )}

      {t.expanded ? (
        <div className="mt-2 space-y-2">
          {t.comments.length > 1 ? (
            <button
              type="button"
              onClick={() => t.setSortAsc(!t.sortAsc)}
              className="flex items-center gap-1 text-footnote text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
            >
              <ArrowUpDown className="h-3 w-3" />
              {t.sortAsc ? 'Oldest first' : 'Newest first'}
            </button>
          ) : null}

          {aiAvailable && t.comments.length >= 3 && <ThreadSummary comments={t.comments} />}

          {t.sortedComments.length === 0 ? (
            <p className="px-1 text-xs text-[var(--color-muted-foreground)]">
              No comments yet.
            </p>
          ) : (
            t.sortedComments.map((c) => (
              <CommentRow
                key={c.localId}
                comment={c}
                isEditing={t.editingId === c.localId}
                isDeleting={t.deletingId === c.localId}
                isCopied={t.copiedId === c.localId}
                taskServerId={taskServerId}
                currentUserId={t.currentUserId}
                onEdit={() => t.setEditingId(c.localId)}
                onCancelEdit={() => t.setEditingId(null)}
                onSave={(html) => t.update(c.localId, html)}
                onDelete={() => t.setDeletingId(c.localId)}
                onConfirmDelete={() => t.remove(c.localId)}
                onCancelDelete={() => t.setDeletingId(null)}
                onCopyPermalink={() => t.copyPermalink(c)}
              />
            ))
          )}

          <CommentCreateForm
            onSave={t.create}
            taskLocalId={taskLocalId}
            taskServerId={taskServerId}
            mentionSearch={mentionSearch}
          />
        </div>
      ) : null}
    </section>
  );
}

function CommentsHeader({
  expanded,
  total,
  unread,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  unread: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1 text-left group-label text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
    >
      {expanded ? (
        <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronRight className="h-3 w-3 shrink-0" />
      )}
      <MessageSquare className="h-3 w-3" />
      Comments
      {total > 0 ? <span className="font-normal">{total}</span> : null}
      {unread > 0 ? (
        <span className="ml-auto rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-micro font-normal text-[var(--color-primary-foreground)]">
          {unread} new
        </span>
      ) : null}
    </button>
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

  const initials = useMemo(() => authorInitials(comment.authorName), [comment.authorName]);
  const avatarColour = useMemo(() => avatarFill(comment.authorName), [comment.authorName]);

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
            className="cursor-pointer rounded bg-[var(--color-destructive)] px-2 py-0.5 text-footnote font-medium text-[var(--color-destructive-foreground)] hover:opacity-90"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            className="cursor-pointer rounded px-2 py-0.5 text-footnote text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
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
          className="mt-1 cursor-pointer text-footnote text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
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
          <circle cx="16" cy="16" r="16" fill={avatarColour} />
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
      {/* Same read-only renderer as the description, so inline images
          (Cria's, Vikunja-web's, queued uploads) load with auth. */}
      <RichTextView
        html={comment.comment}
        taskServerId={taskServerId}
        className="prose prose-sm max-w-none break-words text-xs leading-relaxed text-[var(--color-foreground)] [&_a]:cursor-pointer [&_a]:underline [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-2 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-footnote [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded"
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
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption leading-none cursor-pointer transition-colors ${
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
  mentionSearch,
}: {
  onSave: (html: string) => Promise<void>;
  taskLocalId: string;
  taskServerId: number | null;
  mentionSearch?: MentionSearch;
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
        mentionSearch={mentionSearch}
      />
    </div>
  );
}
