import { describe, expect, it } from 'vitest';
import type { Project } from '@/domain/project';
import {
  computeDropPosition,
  computeSyncLine,
  timeAgo,
  visibleProjectList,
} from '@/features/projects/sidebarLogic';

const proj = (localId: string, extra: Partial<Project> = {}) =>
  ({ localId, title: localId, serverId: 1, position: null, ...extra }) as unknown as Project;

describe('timeAgo', () => {
  const now = 1_000_000_000_000;
  const ago = (s: number) => new Date(now - s * 1000);
  it('buckets seconds, minutes and hours', () => {
    expect(timeAgo(ago(5), now)).toBe('just now');
    expect(timeAgo(ago(120), now)).toBe('2m ago');
    expect(timeAgo(ago(7300), now)).toBe('2h ago');
    expect(timeAgo(new Date(now + 5000), now)).toBe('just now');
  });
});

describe('visibleProjectList', () => {
  it('hides pseudo-projects and Favorites', () => {
    const list = [
      proj('a'),
      proj('unsynced', { serverId: null }),
      proj('fav', { serverId: -1 }),
      proj('filter', { serverId: -5 }),
      proj('named', { title: 'Favorites' }),
    ];
    expect(visibleProjectList(list).map((p) => p.localId)).toEqual(['a', 'unsynced']);
  });
});

describe('computeDropPosition', () => {
  const list = [
    proj('a', { position: 1024 }),
    proj('b', { position: 2048 }),
    proj('c', { position: 4096 }),
  ];
  it('is null for unknown ids and no-op drops', () => {
    expect(computeDropPosition(list, 'zz', 0)).toBeNull();
    expect(computeDropPosition(list, 'a', 0)).toBeNull();
  });
  it('uses the midpoint of the new neighbours', () => {
    expect(computeDropPosition(list, 'a', 1)).toBe((2048 + 4096) / 2);
    expect(computeDropPosition(list, 'c', 0)).toBe((0 + 1024) / 2);
  });
  it('extends past the last neighbour when dropped at the end', () => {
    expect(computeDropPosition(list, 'a', 2)).toBe((4096 + 4096 + 2048) / 2);
  });
});

describe('computeSyncLine', () => {
  const ok = { online: true, outboxCount: 0, deadLetterCount: 0, conflictCount: 0, lastSync: null };
  it('prioritises offline, dead letters, conflicts, outbox, then idle', () => {
    expect(computeSyncLine({ ...ok, online: false, outboxCount: 2 })).toMatchObject({
      text: 'Offline — 2 saved locally',
      target: 'outbox',
    });
    expect(computeSyncLine({ ...ok, online: false }).text).toBe('Offline');
    expect(computeSyncLine({ ...ok, deadLetterCount: 2, conflictCount: 1 })).toMatchObject({
      text: "2 changes wouldn't send",
      action: 'Review',
      target: 'outbox',
    });
    expect(computeSyncLine({ ...ok, conflictCount: 1, outboxCount: 3 })).toMatchObject({
      text: '1 conflict',
      action: 'Resolve',
      target: 'conflicts',
    });
    expect(computeSyncLine({ ...ok, outboxCount: 1 })).toMatchObject({
      text: 'Sending 1 change…',
      target: 'outbox',
    });
  });
  it('shows the last sync time when idle', () => {
    const now = 1_000_000_000_000;
    expect(computeSyncLine(ok, now)).toMatchObject({ text: 'All synced', target: null });
    expect(
      computeSyncLine({ ...ok, lastSync: new Date(now - 180_000) }, now).text,
    ).toBe('All synced · 3m ago');
  });
});
