import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  defaultConfigFor,
  type DisplayConfig,
  type ViewKey,
} from '@/lib/displayConfig';
import type { Task } from '@/domain/task';

interface DisplayState {
  /** Per-view config, keyed by ViewKey. Missing → defaultConfigFor(key). */
  configs: Record<string, DisplayConfig>;
  /** Transient: which view's Display sheet is open (null = closed). */
  sheetFor: ViewKey | null;
  /** Transient: the task whose long-press action sheet is open. */
  actionTask: Task | null;

  /* multi-select (not persisted) */
  selecting: boolean;
  selected: Record<string, true>;

  setConfig: (key: ViewKey, patch: Partial<DisplayConfig>) => void;
  openSheet: (key: ViewKey) => void;
  closeSheet: () => void;
  openActions: (task: Task) => void;
  closeActions: () => void;

  startSelecting: (firstId?: string) => void;
  stopSelecting: () => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
}

export const useDisplay = create<DisplayState>()(
  persist(
    (set) => ({
      configs: {},
      sheetFor: null,
      actionTask: null,
      selecting: false,
      selected: {},

      setConfig: (key, patch) =>
        set((s) => {
          const current = s.configs[key] ?? defaultConfigFor(key);
          return {
            configs: {
              ...s.configs,
              [key]: {
                ...current,
                ...patch,
                // shallow-merge filters so callers can patch one filter at a time
                filters: patch.filters
                  ? { ...current.filters, ...patch.filters }
                  : current.filters,
              },
            },
          };
        }),
      openSheet: (key) => set({ sheetFor: key }),
      closeSheet: () => set({ sheetFor: null }),
      openActions: (task) => set({ actionTask: task }),
      closeActions: () => set({ actionTask: null }),

      startSelecting: (firstId) =>
        set({ selecting: true, selected: firstId ? { [firstId]: true } : {} }),
      stopSelecting: () => set({ selecting: false, selected: {} }),
      toggleSelected: (id) =>
        set((s) => {
          const next = { ...s.selected };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { selected: next };
        }),
      clearSelected: () => set({ selected: {} }),
    }),
    {
      name: 'cria:display/v1',
      // Persist only the per-view configs; selection + open-sheet are transient.
      partialize: (s) => ({ configs: s.configs }),
    },
  ),
);
