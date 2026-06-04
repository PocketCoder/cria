// Coverage for the deferred-delete store (issue #25).
//
// The data-loss-sensitive invariant: hitting Undo MUST cancel the
// pending commit, so a task you rescued never gets deleted. And the
// converse: if you don't undo, the real deleteTask fires exactly once
// after the window. Both are pinned here with fake timers + a mocked
// deleteTask so nothing touches the DB.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

// Hoisted so the mock factory (itself hoisted above imports) can close
// over the same spy we assert on below.
const { deleteTask } = vi.hoisted(() => ({
  deleteTask: vi.fn(async (_localId: string): Promise<void> => {}),
}));
vi.mock('@/db/tasks', () => ({ deleteTask }));

import { usePendingDeletes, UNDO_WINDOW_MS } from '@/stores/pendingDeletes';
import type { Task } from '@/domain/task';

function makeTask(localId: string, title = 'A task'): Task {
  return {
    localId,
    serverId: null,
    projectLocalId: 'proj_1',
    title,
    description: null,
    done: false,
    doneAt: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    priority: 0,
    percentDone: 0,
    hexColor: null,
    position: null,
    isFavorite: false,
    isSubscribed: false,
    repeatAfter: 0,
    repeatMode: 0,
    identifier: null,
    updatedAt: new Date().toISOString(),
    createdAt: null,
    createdById: null,
  };
}

describe('pendingDeletes store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deleteTask.mockClear();
    usePendingDeletes.setState({ pending: {} });
    globalThis.__cria_pendingDeleteTimers__?.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('enqueue stashes the task and shows it as pending', () => {
    usePendingDeletes.getState().enqueue(makeTask('t1'));
    expect(usePendingDeletes.getState().pending['t1']).toBeDefined();
  });

  it('commits the real delete after the undo window elapses', async () => {
    usePendingDeletes.getState().enqueue(makeTask('t1'));
    expect(deleteTask).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(deleteTask).toHaveBeenCalledTimes(1);
    expect(deleteTask).toHaveBeenCalledWith('t1');
    expect(usePendingDeletes.getState().pending['t1']).toBeUndefined();
  });

  it('undo cancels the pending delete — deleteTask is NEVER called', async () => {
    usePendingDeletes.getState().enqueue(makeTask('t1'));
    usePendingDeletes.getState().undo('t1');

    expect(usePendingDeletes.getState().pending['t1']).toBeUndefined();

    // Even well past the window, the rescued task must not be deleted.
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2);
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('enqueueing the same task twice keeps a single entry/timer', async () => {
    const task = makeTask('t1');
    usePendingDeletes.getState().enqueue(task);
    usePendingDeletes.getState().enqueue(task);

    expect(Object.keys(usePendingDeletes.getState().pending)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(deleteTask).toHaveBeenCalledTimes(1);
  });

  it('tracks independent windows for multiple tasks', async () => {
    usePendingDeletes.getState().enqueue(makeTask('t1'));
    usePendingDeletes.getState().enqueue(makeTask('t2'));
    expect(Object.keys(usePendingDeletes.getState().pending)).toHaveLength(2);

    // Undo only t1; t2 should still commit.
    usePendingDeletes.getState().undo('t1');
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(deleteTask).toHaveBeenCalledTimes(1);
    expect(deleteTask).toHaveBeenCalledWith('t2');
  });
});
