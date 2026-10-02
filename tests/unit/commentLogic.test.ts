import { describe, expect, it } from 'vitest';
import {
  authorInitials,
  avatarFill,
  commentPermalink,
  formatTimeAgo,
  sortComments,
} from '@/features/task-detail/commentLogic';
import type { TaskComment } from '@/db/comments';

const c = (localId: string, createdAt: string | null) => ({ localId, createdAt }) as TaskComment;

describe('commentLogic', () => {
  it('sorts by creation time in either direction without mutating', () => {
    const list = [c('b', '2026-01-02T00:00:00Z'), c('a', '2026-01-01T00:00:00Z'), c('n', null)];
    expect(sortComments(list, true).map((x) => x.localId)).toEqual(['n', 'a', 'b']);
    expect(sortComments(list, false).map((x) => x.localId)).toEqual(['b', 'a', 'n']);
    expect(list.map((x) => x.localId)).toEqual(['b', 'a', 'n']);
  });

  it('builds the best permalink it can', () => {
    const base = { authorName: 'Sam', createdAt: '2026-01-01' };
    expect(
      commentPermalink({
        serverUrl: 'https://v.test///',
        taskServerId: 7,
        comment: { ...base, serverId: 9 },
      }),
    ).toBe('https://v.test/tasks/7#comment-9');
    expect(
      commentPermalink({ serverUrl: null, taskServerId: 7, comment: { ...base, serverId: 9 } }),
    ).toBe('#comment-9');
    expect(
      commentPermalink({ serverUrl: 'https://v.test', taskServerId: 7, comment: { ...base, serverId: null } }),
    ).toBe('comment by Sam at 2026-01-01');
    expect(
      commentPermalink({
        serverUrl: null,
        taskServerId: null,
        comment: { authorName: null, createdAt: null, serverId: null },
      }),
    ).toBe('comment by Unknown at ');
  });

  it('derives initials', () => {
    expect(authorInitials(null)).toBe('?');
    expect(authorInitials('ada lovelace')).toBe('AL');
    expect(authorInitials('  Grace  Brewster  Hopper ')).toBe('GH');
    expect(authorInitials('plato')).toBe('PL');
  });

  it('gives the same name the same colour', () => {
    expect(avatarFill('Ada')).toBe(avatarFill('Ada'));
    expect(avatarFill('Ada')).toMatch(/^hsl\(\d+, 55%, 50%\)$/);
    expect(avatarFill(null)).toBe('hsl(0, 55%, 50%)');
  });

  it('formats relative times', () => {
    const now = new Date('2026-03-10T12:00:00Z').getTime();
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatTimeAgo(null, now)).toBe('');
    expect(formatTimeAgo('not a date', now)).toBe('');
    expect(formatTimeAgo(ago(30_000), now)).toBe('just now');
    expect(formatTimeAgo(ago(5 * 60_000), now)).toBe('5m ago');
    expect(formatTimeAgo(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(formatTimeAgo(ago(2 * 86_400_000), now)).toBe('2d ago');
    expect(formatTimeAgo(ago(15 * 86_400_000), now)).toBe('2w ago');
    expect(formatTimeAgo(ago(60 * 86_400_000), now)).not.toMatch(/ago$/);
  });
});
