import { lazy, Suspense } from 'react';
import { Plus, Search } from 'lucide-react';
import { OutboxModal } from '@/components/OutboxModal';
import { ConflictModal } from '@/components/ConflictModal';
import { UndoToasts } from '@/components/UndoToast';
import { Toasts } from '@/components/Toasts';
import { LabelManagerModal } from '@/components/LabelManagerModal';
import { ViewManagerModal } from '@/features/projects/ViewManagerModal';
import { DisplaySheet } from '@/features/shell/DisplaySheet';
import { TaskActionSheet } from '@/features/tasks/TaskActionSheet';
import { SelectionBar } from '@/features/tasks/SelectionBar';
import { useFocusOnMount } from '@/lib/useFocusOnMount';
import { SearchView } from '@/features/search/SearchView';
import type { ShellModals, ShellSearch } from './useShellState';

// Modals/overlays that only mount when opened — code-split so their bundles
// (and the command palette's search machinery) load on first open, not at boot.
const QuickAddModal = lazy(() =>
  import('@/components/QuickAddModal').then((m) => ({ default: m.QuickAddModal })),
);
const PhotoTaskCreator = lazy(() =>
  import('@/features/shoppingPhoto/PhotoTaskCreator').then((m) => ({
    default: m.PhotoTaskCreator,
  })),
);
const RambleModal = lazy(() =>
  import('@/features/ramble/RambleModal').then((m) => ({ default: m.RambleModal })),
);
const CommandPalette = lazy(() =>
  import('@/components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const SettingsModal = lazy(() =>
  import('@/components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);

/** Every modal / sheet / toast the shell can open. */
export function ShellOverlays({
  modals,
  photoCaptureOpen,
  setPhotoCaptureOpen,
  rambleOpen,
  setRambleOpen,
  viewManager,
}: {
  modals: ShellModals;
  photoCaptureOpen: boolean;
  setPhotoCaptureOpen: (open: boolean) => void;
  rambleOpen: boolean;
  setRambleOpen: (open: boolean) => void;
  /** The open project's views, when they can be managed (else null). */
  viewManager: {
    projectLocalId: string;
    activeViewLocalId: string | undefined;
    onSelectView: (viewLocalId: string) => void;
  } | null;
}) {
  const m = modals;
  return (
    <>
      {m.showOutbox && <OutboxModal onClose={() => m.setShowOutbox(false)} />}
      {m.showConflicts && <ConflictModal onClose={() => m.setShowConflicts(false)} />}
      <DisplaySheet />
      <TaskActionSheet />
      <SelectionBar />
      {/* Lazy modals — null fallback is fine; they animate in on open, so a
          brief invisible gap while the chunk loads is imperceptible. */}
      {m.showQuickAdd && (
        <Suspense fallback={null}>
          <QuickAddModal onClose={() => m.setShowQuickAdd(false)} />
        </Suspense>
      )}
      {photoCaptureOpen && (
        <Suspense fallback={null}>
          <PhotoTaskCreator onClose={() => setPhotoCaptureOpen(false)} />
        </Suspense>
      )}
      {rambleOpen && (
        <Suspense fallback={null}>
          <RambleModal onClose={() => setRambleOpen(false)} />
        </Suspense>
      )}
      {m.showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            initialTab={m.settingsTab}
            onClose={() => {
              m.setShowSettings(false);
              m.setSettingsTab(undefined);
            }}
          />
        </Suspense>
      )}
      {m.showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => m.setShowCommandPalette(false)}
            onOpenQuickAdd={() => m.setShowQuickAdd(true)}
            onOpenSettings={() => m.setShowSettings(true)}
          />
        </Suspense>
      )}
      {m.showLabelManager && (
        <LabelManagerModal onClose={() => m.setShowLabelManager(false)} />
      )}
      {m.showViewManager && viewManager && (
        <ViewManagerModal
          projectLocalId={viewManager.projectLocalId}
          activeViewLocalId={viewManager.activeViewLocalId}
          onSelectView={viewManager.onSelectView}
          onClose={() => m.setShowViewManager(false)}
        />
      )}
      <UndoToasts />
      <Toasts />
    </>
  );
}

/** Full-screen mobile search overlay. */
export function MobileSearchOverlay({ search }: { search: ShellSearch }) {
  const {
    searchInputRef,
    searchQuery,
    handleSearchChange,
    handleSearchKeyDown,
    handleSearchClear,
    setMobileSearchOpen,
  } = search;
  const focusSearch = useFocusOnMount<HTMLInputElement>(searchInputRef);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)] safe-top"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
          <input
            aria-label="Search tasks"
            ref={focusSearch}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search tasks…"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-input)] py-2 pl-9 pr-4 text-base focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setMobileSearchOpen(false);
            handleSearchClear();
          }}
          className="shrink-0 text-sm text-[var(--color-primary)]"
        >
          Cancel
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {searchQuery.trim() ? (
          <SearchView query={searchQuery} />
        ) : (
          <div className="flex items-center justify-center p-8 text-sm text-[var(--color-muted-foreground)]">
            Type to search tasks
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Floating action button — purple circle anchored above the tab bar.
 * Mobile only; the caller hides it while a full-screen overlay owns the screen.
 */
export function MobileFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Add task"
      onClick={onClick}
      className="fab fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full"
      style={{ bottom: 'calc(var(--tabbar-offset) + 78px)' }}
    >
      <Plus className="h-7 w-7" strokeWidth={2.5} />
    </button>
  );
}
