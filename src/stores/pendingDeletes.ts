import { create } from 'zustand';
import { deleteTask } from '@/db/tasks';
import type { Task } from '@/domain/task';

/**
 * Undo-able task deletion (issue #25).
 *
 * Design: **deferred delete**, not delete-then-undo. When the user hits
 * the trash icon we DON'T touch the DB — we stash the task here and the
 * UI filters it out of the list immediately (looks deleted). A toast
 * offers Undo for {@link UNDO_WINDOW_MS}. If the window elapses we run
 * the real `deleteTask` (soft-delete + outbox 'delete'); if the user
 * hits Undo first, we just drop it from the queue and it reappears —
 * nothing was ever written.
 *
 * Why deferred rather than the issue's "soft-delete immediately, cancel
 * the outbox row on undo" sketch: the outbox drains within seconds of
 * the notify(), so by the time a user reacts the delete has usually
 * already hit the server and undo would have to re-create it. Deferring
 * the commit makes undo 100% reliable with no server round-trip.
 */
const UNDO_WINDOW_MS = 15_000;

// Timers aren't render state, so they live outside the store. Pinned to
// globalThis so a Vite HMR reload of this module mid-window doesn't
// orphan a pending commit — same rationale as the db-layer globals in
// CLAUDE.md, though here the worst case is only a late/missed delete.
declare global {
  // eslint-disable-next-line no-var
  var __cria_pendingDeleteTimers__:
    | Map<string, ReturnType<typeof setTimeout>>
    | undefined;
}
const timers = (globalThis.__cria_pendingDeleteTimers__ ??= new Map());

interface PendingDeletesState {
  /** Tasks queued for deletion, keyed by localId, with enqueuedAt timestamp. */
  pending: Record<string, { task: Task; enqueuedAt: number }>;
  /** Stash a task and start its undo countdown. */
  enqueue: (task: Task) => void;
  /** Cancel a pending delete — the task reappears, DB untouched. */
  undo: (localId: string) => void;
  /** Window elapsed: run the real delete and drop from the queue. */
  commit: (localId: string) => void;
}

export const usePendingDeletes = create<PendingDeletesState>((set, get) => ({
  pending: {},

  enqueue: (task) => {
    if (get().pending[task.localId]) return; // already queued
    set((s) => ({
      pending: { ...s.pending, [task.localId]: { task, enqueuedAt: Date.now() } },
    }));
    const t = setTimeout(() => get().commit(task.localId), UNDO_WINDOW_MS);
    timers.set(task.localId, t);
  },

  undo: (localId) => {
    if (!timers.delete(localId)) return; // timer already fired — commit in flight
    set((s) => {
      if (!(localId in s.pending)) return s;
      const next = { ...s.pending };
      delete next[localId];
      return { pending: next };
    });
  },

  commit: async (localId) => {
    timers.delete(localId);
    const entry = get().pending[localId];
    if (!entry) return;
    try {
      await deleteTask(localId);
    } catch (err) {
      console.error('[pendingDeletes] commit failed:', err);
    }
    set((s) => {
      const next = { ...s.pending };
      delete next[localId];
      return { pending: next };
    });
  },
}));

export { UNDO_WINDOW_MS };
