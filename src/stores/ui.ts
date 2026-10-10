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

/** A Ramble row kept for the next open, stored as written (never re-parsed from text). */
export interface KeptRow {
  line: string;
  suggestion?: string;
  notes?: string;
}

interface UiState {
  activeView: ActiveView | null;
  selectedTaskLocalId: string | null;
  sidebarCollapsed: boolean;
  /** Transient: the "create tasks from a photo" capture modal is open. */
  photoCaptureOpen: boolean;
  /** Transient: the Ramble (speak → many tasks) sheet is open. */
  rambleOpen: boolean;
  /** Transient: lines organised after the sheet was closed, for the next open to review. */
  rambleRows: KeptRow[] | null;
  setActiveView: (view: ActiveView | null) => void;
  /** Convenience for the common "open a project" path. */
  setSelectedProject: (id: string | null) => void;
  setSelectedTask: (id: string | null) => void;
  toggleSidebar: () => void;
  setPhotoCaptureOpen: (open: boolean) => void;
  setRambleOpen: (open: boolean) => void;
  setRambleRows: (rows: KeptRow[] | null) => void;
}

/** Bumped by every `setSelectedTask`; lets a deferred view commit spot a newer selection. */
let selectionEpoch = 0;

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

// The row currently carrying `task-title`, and a token for the latest claim.
// A close's cleanup runs only once its animation finishes, so a quick
// close-then-open would otherwise leave two rows sharing the name.
let titleEl: HTMLElement | null = null;
let titleClaim = 0;

/** Name `el` as the shared title, taking the name from any other row. Returns the release. */
function claimTitle(el: HTMLElement | null): () => void {
  if (titleEl) titleEl.style.viewTransitionName = '';
  titleEl = el;
  const id = ++titleClaim;
  if (el) el.style.viewTransitionName = 'task-title';
  // A stale release must not strip a newer claim's name (even on the same row).
  return () => {
    if (id !== titleClaim) return;
    if (el) el.style.viewTransitionName = '';
    titleEl = null;
  };
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
    const release = claimTitle(rowTitle(next));
    void withViewTransition('task', commit, {
      waitFor: '[data-inspector-title]',
      afterUpdate: release,
    });
    return;
  }
  let release = () => {};
  void withViewTransition('task', commit, {
    afterUpdate: () => {
      release = claimTitle(rowTitle(prev!));
    },
  }).then(() => release());
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
      rambleOpen: false,
      rambleRows: null,
      setActiveView: (view) => {
        // The view commit can land a frame late (View Transition). Clear the
        // selection only if nothing selected a task in between, else
        // "switch project, then open task" loses the task.
        const epoch = selectionEpoch;
        const commit = () =>
          set(
            epoch === selectionEpoch
              ? { activeView: view, selectedTaskLocalId: null }
              : { activeView: view },
          );
        const kind = navKind(get().activeView, view);
        if (kind) withViewTransition(kind, commit);
        else commit();
      },
      setSelectedProject: (id) =>
        get().setActiveView(id ? { kind: 'project', localId: id } : null),
      setSelectedTask: (id) => {
        selectionEpoch++;
        transitionTask(get().selectedTaskLocalId, id, () =>
          set({ selectedTaskLocalId: id }),
        );
      },
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setPhotoCaptureOpen: (open) => set({ photoCaptureOpen: open }),
      setRambleOpen: (open) => set({ rambleOpen: open }),
      setRambleRows: (rows) => set({ rambleRows: rows }),
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
