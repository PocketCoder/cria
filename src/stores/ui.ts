import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  selectedProjectLocalId: string | null;
  selectedTaskLocalId: string | null;
  sidebarCollapsed: boolean;
  setSelectedProject: (id: string | null) => void;
  setSelectedTask: (id: string | null) => void;
  toggleSidebar: () => void;
}

/**
 * Pure UI state — selection, layout toggles, etc. Persisted to localStorage
 * so sidebar collapse / last-selected project survive relaunch.
 */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      selectedProjectLocalId: null,
      selectedTaskLocalId: null,
      sidebarCollapsed: false,
      setSelectedProject: (id) =>
        set({ selectedProjectLocalId: id, selectedTaskLocalId: null }),
      setSelectedTask: (id) => set({ selectedTaskLocalId: id }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'cria:ui/v1' },
  ),
);
