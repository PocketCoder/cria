import { create } from 'zustand';
import { checkForUpdate, installUpdate, type AvailableUpdate } from '@/tauri/updater';

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: AvailableUpdate }
  | { kind: 'installing'; update: AvailableUpdate }
  | { kind: 'error'; message: string };

interface UpdaterStore {
  state: UpdaterState;
  runCheck: () => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterStore>()((set, get) => ({
  state: { kind: 'idle' },

  runCheck: async () => {
    set({ state: { kind: 'checking' } });
    try {
      const update = await checkForUpdate();
      if (update) {
        set({ state: { kind: 'available', update } });
      } else {
        set({ state: { kind: 'idle' } });
      }
    } catch (err) {
      console.warn('[updater] check failed:', err);
      set({ state: { kind: 'idle' } });
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
