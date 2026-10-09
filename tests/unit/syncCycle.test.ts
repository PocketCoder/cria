import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];
const pull = vi.hoisted(() => ({
  pullProjects: vi.fn(),
  pullSavedFilters: vi.fn(),
  pullLabels: vi.fn(),
  pullAllTasks: vi.fn(),
  pullAllViews: vi.fn(),
  pullAllBuckets: vi.fn(),
}));
const push = vi.hoisted(() => ({ drainOutbox: vi.fn() }));
const bus = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@/sync/pull', () => pull);
vi.mock('@/sync/push', () => push);
vi.mock('@/db/bus', () => bus);
vi.mock('@/api/resilience', () => ({ throttledWarn: vi.fn() }));

import { runSyncCycle, isSyncCycleRunning, lastSyncCycleAt } from '@/sync/syncCycle';

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  for (const [name, fn] of Object.entries({ ...pull, ...push })) {
    (fn as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push(name);
    });
  }
  bus.notify.mockImplementation((topic: string) => {
    order.push(`notify:${topic}`);
  });
});

describe('runSyncCycle', () => {
  it('drains, then pulls each entity with one notify per topic after its pull', async () => {
    await runSyncCycle();
    expect(order).toEqual([
      'drainOutbox',
      'pullProjects',
      'notify:projects',
      'pullSavedFilters',
      'notify:saved_filters',
      'pullLabels',
      'notify:labels',
      'pullAllTasks',
      'notify:tasks',
      'pullAllViews',
      'pullAllBuckets',
      'notify:views',
    ]);
  });

  it('a failing step does not stop the rest, and does not notify for itself', async () => {
    pull.pullLabels.mockRejectedValueOnce(new Error('500'));
    await runSyncCycle();
    expect(order).not.toContain('notify:labels');
    expect(order).toContain('pullAllTasks');
    expect(order).toContain('notify:views');
  });

  it('reports itself running only while in flight, and records when it finished', async () => {
    expect(isSyncCycleRunning()).toBe(false);
    const before = lastSyncCycleAt();
    let release!: () => void;
    pull.pullAllTasks.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const done = runSyncCycle();
    await vi.waitFor(() => expect(pull.pullAllTasks).toHaveBeenCalled());
    expect(isSyncCycleRunning()).toBe(true);
    release();
    await done;
    expect(isSyncCycleRunning()).toBe(false);
    expect(lastSyncCycleAt()).toBeGreaterThanOrEqual(before);
    expect(lastSyncCycleAt()).toBeGreaterThan(0);
  });
});
