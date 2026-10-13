import { create } from 'zustand';
import { checkForUpdate, installUpdate, type AvailableUpdate } from '@/tauri/updater';
import { syncBeforeUpdate, UNSYNCED_MESSAGE } from '@/sync/updateGate';

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: AvailableUpdate }
  | { kind: 'upToDate' }
  | { kind: 'installing'; update: AvailableUpdate }
  | { kind: 'error'; message: string };

interface UpdaterStore {
  state: UpdaterState;
  /** Set when an install was held back because local edits are unsynced; cleared on the next attempt. */
  blockedMessage: string | null;
  runCheck: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterStore>()((set, get) => ({
  state: { kind: 'idle' },
  blockedMessage: null,

  runCheck: async (silent?: boolean) => {
    set({ state: { kind: 'checking' } });
    try {
      const update = await checkForUpdate();
      if (update) {
        set({ state: { kind: 'available', update } });
      } else if (silent) {
        set({ state: { kind: 'idle' } });
      } else {
        set({ state: { kind: 'upToDate' } });
        setTimeout(() => {
          const current = get().state;
          if (current.kind === 'upToDate') set({ state: { kind: 'idle' } });
        }, 4000);
      }
    } catch (err) {
      console.warn('[updater] check failed:', err);
      if (silent) {
        set({ state: { kind: 'idle' } });
      } else {
        set({
          state: {
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  },

  install: async () => {
    const { state } = get();
    if (state.kind !== 'available') return;
    const { update } = state;
    set({ state: { kind: 'installing', update } });
    try {
      const gate = await syncBeforeUpdate();
      if (!gate.ok) {
        // Back to 'available' so the same button retries once the edits have synced.
        set({ state: { kind: 'available', update }, blockedMessage: UNSYNCED_MESSAGE });
        return;
      }
      set({ blockedMessage: null });
      await installUpdate(update);
    } catch (err) {
      console.error('[updater] install failed:', err);
      set({
        state: {
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },
}));
