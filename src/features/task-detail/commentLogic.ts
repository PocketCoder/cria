import type { TaskComment } from '@/db/comments';

/** Comments ordered by creation time; missing timestamps sort first. */
export function sortComments(comments: readonly TaskComment[], ascending: boolean): TaskComment[] {
  const time = (c: TaskComment) => (c.createdAt ? new Date(c.createdAt).getTime() : 0);
  return [...comments].sort((a, b) => (ascending ? time(a) - time(b) : time(b) - time(a)));
}

/**
 * Link text for "Copy comment link": a full URL when the server, task and
 * comment are all known, else the bare anchor, else a plain description.
 */
export function commentPermalink(args: {
  serverUrl: string | null | undefined;
  taskServerId: number | null;
  comment: { serverId: number | null; authorName: string | null; createdAt: string | null };
}): string {
  const { serverUrl, taskServerId, comment } = args;
  if (serverUrl && taskServerId && comment.serverId) {
    return `${serverUrl.replace(/\/+$/, '')}/tasks/${taskServerId}#comment-${comment.serverId}`;
  }
  if (comment.serverId) return `#comment-${comment.serverId}`;
  return `comment by ${comment.authorName ?? 'Unknown'} at ${comment.createdAt ?? ''}`;
}

/** Two-letter avatar initials: first and last word initials, else the first two letters. */
export function authorInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (parts.length >= 2 && first && last) {
    return (first.charAt(0) + last.charAt(0)).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Stable avatar colour derived from the author's name. */
export function avatarFill(name: string | null): string {
  let hash = 0;
  const text = name ?? '';
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash % 360)}, 55%, 50%)`;
}

/** "just now", "5m ago", "3d ago", "2w ago", then a short date. */
export function formatTimeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
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
