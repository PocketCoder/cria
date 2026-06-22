import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * What the main pane is currently showing. Either a project's task list
 * or one of the smart views (M6). A discriminated union so callers can
 * switch exhaustively.
 */
export type ActiveView =
  | { kind: 'project'; localId: string; viewLocalId?: string }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'label'; localId: string }
  | { kind: 'search' }
  | { kind: 'favorites' }
  | { kind: 'inbox' };

interface UiState {
  activeView: ActiveView | null;
  selectedTaskLocalId: string | null;
  sidebarCollapsed: boolean;
  /** Transient: the "create tasks from a photo" capture modal is open. */
  photoCaptureOpen: boolean;
  setActiveView: (view: ActiveView | null) => void;
  /** Convenience for the common "open a project" path. */
  setSelectedProject: (id: string | null) => void;
  setSelectedTask: (id: string | null) => void;
  toggleSidebar: () => void;
  setPhotoCaptureOpen: (open: boolean) => void;
}

/**
 * Pure UI state — selection, layout toggles, etc. Persisted to localStorage
 * so the active view + sidebar collapse survive relaunch. The open task
 * (detail card) is intentionally NOT persisted — it's a transient
 * inspector and should start closed.
 */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      activeView: { kind: 'today' },
      selectedTaskLocalId: null,
      sidebarCollapsed: false,
      photoCaptureOpen: false,
      setActiveView: (view) =>
        set({ activeView: view, selectedTaskLocalId: null }),
      setSelectedProject: (id) =>
        set({
          activeView: id ? { kind: 'project', localId: id } : null,
          selectedTaskLocalId: null,
        }),
      setSelectedTask: (id) => set({ selectedTaskLocalId: id }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setPhotoCaptureOpen: (open) => set({ photoCaptureOpen: open }),
    }),
    {
      name: 'cria:ui/v2',
      partialize: (s) => ({
        activeView: s.activeView,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);
