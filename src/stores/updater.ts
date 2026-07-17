import { create } from 'zustand';
import { checkForUpdate, installUpdate, type AvailableUpdate } from '@/tauri/updater';

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: AvailableUpdate }
  | { kind: 'upToDate' }
  | { kind: 'installing'; update: AvailableUpdate }
  | { kind: 'error'; message: string };

interface UpdaterStore {
  state: UpdaterState;
  runCheck: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterStore>()((set, get) => ({
  state: { kind: 'idle' },

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
