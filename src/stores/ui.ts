import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { canAnimate, withViewTransition, type TransitionKind } from '@/lib/viewTransition';

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
  | { kind: 'inbox' }
  | { kind: 'browse' };

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

function viewKey(v: ActiveView | null): string {
  return JSON.stringify(v);
}

/** `view` for a List/Kanban/Table/Gantt switch inside one project, else `nav`. */
function navKind(prev: ActiveView | null, next: ActiveView | null): TransitionKind | null {
  if (viewKey(prev) === viewKey(next)) return null;
  if (prev?.kind === 'project' && next?.kind === 'project' && prev.localId === next.localId) {
    return 'view';
  }
  return 'nav';
}

/** The row's title text, which morphs to and from the inspector's <h2>. */
function rowTitle(taskLocalId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-task-row="${CSS.escape(taskLocalId)}"] .task-strike`,
  );
}

function setTitleName(el: HTMLElement | null, on: boolean) {
  if (el) el.style.viewTransitionName = on ? 'task-title' : '';
}

/**
 * Desktop inspector open/close/switch. The row title carries the shared name
 * only on the side of the transition where the inspector is closed, because
 * two live elements with one name abort the transition. Mobile skips this:
 * the inspector is a bottom sheet with its own sheet-up animation.
 */
function transitionTask(prev: string | null, next: string | null, commit: () => void) {
  if (prev === next || !canAnimate() || window.matchMedia('(max-width: 768px)').matches) {
    return commit();
  }
  if (prev && next) {
    void withViewTransition('task', commit);
    return;
  }
  if (next) {
    const el = rowTitle(next);
    setTitleName(el, true);
    void withViewTransition('task', commit, {
      waitFor: '[data-inspector-title]',
      afterUpdate: () => setTitleName(el, false),
    });
    return;
  }
  let el: HTMLElement | null = null;
  void withViewTransition('task', commit, {
    afterUpdate: () => {
      el = rowTitle(prev!);
      setTitleName(el, true);
    },
  }).then(() => setTitleName(el, false));
}

/**
 * Pure UI state — selection, layout toggles, etc. Persisted to localStorage
 * so the active view + sidebar collapse survive relaunch. The open task
 * (detail card) is intentionally NOT persisted — it's a transient
 * inspector and should start closed.
 */
export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      activeView: { kind: 'today' },
      selectedTaskLocalId: null,
      sidebarCollapsed: false,
      photoCaptureOpen: false,
      setActiveView: (view) => {
        const commit = () => set({ activeView: view, selectedTaskLocalId: null });
        const kind = navKind(get().activeView, view);
        if (kind) withViewTransition(kind, commit);
        else commit();
      },
      setSelectedProject: (id) =>
        get().setActiveView(id ? { kind: 'project', localId: id } : null),
      setSelectedTask: (id) =>
        transitionTask(get().selectedTaskLocalId, id, () =>
          set({ selectedTaskLocalId: id }),
        ),
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

/* ─────────────────────────── Now block (M7) ─────────────────────────── */
