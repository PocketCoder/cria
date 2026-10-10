import { useEffect } from 'react';

import { useOnline } from '@/hooks/useOnline';
import { useUi } from '@/stores/ui';
import { useProjects } from '@/queries/projects';
import { useProjectViews } from '@/queries/views';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import { useOutboxCount } from '@/queries/outbox';
import { useDeadLettersCount } from '@/queries/outboxRows';
import { useConflictsCount } from '@/queries/conflicts';
import { useShortcuts } from '@/hooks/useShortcuts';
import { useUpdaterStore } from '@/stores/updater';
import { UpdateBanner } from '@/features/shell/UpdateBanner';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import { TabBar } from './TabBar';
import { useDisplay } from '@/stores/display';
import { viewKey } from '@/lib/displayConfig';
import { resolveCurrentProjectView, showMobileFab, viewTitle } from './shellLogic';
import { canManageViews } from '@/lib/viewManagement';
import {
  useConflictNotification,
  useDeepLinks,
  useDevShortcuts,
  useGlobalQuickAddShortcut,
  useInitialProjectView,
  useTrayQuickAdd,
  useTraySettingsSync,
} from './useShellEffects';
import { useHeaderDrag, useShellModals, useShellSearch } from './useShellState';
import { MainView } from './MainView';
import { DesktopHeader, MobileHeader } from './ShellHeaders';
import { MobileFab, MobileSearchOverlay, ShellOverlays } from './ShellOverlays';

export function Shell() {
  const { data: projects = [] } = useProjects();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);
  const setSelectedProject = useUi((s) => s.setSelectedProject);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const photoCaptureOpen = useUi((s) => s.photoCaptureOpen);
  const setPhotoCaptureOpen = useUi((s) => s.setPhotoCaptureOpen);
  const rambleOpen = useUi((s) => s.rambleOpen);
  const setRambleOpen = useUi((s) => s.setRambleOpen);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const selectedTaskLocalId = useUi((s) => s.selectedTaskLocalId);
  const openDisplaySheet = useDisplay((s) => s.openSheet);
  const currentViewKey = viewKey(activeView);

  const projectLocalId = activeView?.kind === 'project' ? activeView.localId : '';
  const { data: projectViews = [], isPending: viewsPending } = useProjectViews(projectLocalId);

  const handleSelectView = (viewLocalId: string) => {
    if (activeView?.kind === 'project') {
      setActiveView({ kind: 'project', localId: activeView.localId, viewLocalId });
      localStorage.setItem(`cria:projectView:${activeView.localId}`, viewLocalId);
    }
  };

  useInitialProjectView(activeView, projectViews);

  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: conflictCount = 0 } = useConflictsCount();
  const { data: deadLetterCount = 0 } = useDeadLettersCount();
  const updaterState = useUpdaterStore((s) => s.state);
  const runUpdaterCheck = useUpdaterStore((s) => s.runCheck);
  const installUpdate = useUpdaterStore((s) => s.install);
  // Auto-check for updates on mount (silent failure is fine).
  useEffect(() => { void runUpdaterCheck(true); }, [runUpdaterCheck]);
  const isOnline = useOnline();

  const modals = useShellModals();
  const { setShowQuickAdd, setShowCommandPalette, setShowSettings, setShowOutbox, setShowConflicts } =
    modals;

  useConflictNotification(conflictCount);
  useTrayQuickAdd(setShowQuickAdd);
  useTraySettingsSync();
  useDeepLinks(setSelectedProject, setSelectedTask);

  /* ── mobile layout ────────────────────────────────────── */
  // On phones the three-pane shell collapses to a single pane: the sidebar
  // opens as a bottom sheet via TabBar, the list fills the screen, and
  // TaskDetail renders full-screen (see TaskDetail). Desktop is unaffected.
  const isMobile = useIsMobile();

  /* ── search ───────────────────────────────────────────── */
  const search = useShellSearch(activeView, setActiveView);
  const { mobileSearchOpen, searchQuery } = search;

  useGlobalQuickAddShortcut(setShowQuickAdd);
  useDevShortcuts(setShowQuickAdd, setShowCommandPalette);

  // Fixed Vikunja shortcut set (⌘K palette, ⌘E sidebar, g-sequences,
  // task-detail keys via the shortcut bus). See lib/shortcuts.ts.
  useShortcuts({
    switchView: (kind) => {
      const target = projectViews.find((v) => v.viewKind === kind);
      if (target) handleSelectView(target.localId);
    },
    openQuickSearch: () => setShowCommandPalette((v) => !v),
    openLabelManager: () => modals.setShowLabelManager(true),
    openTeams: () => {
      modals.setSettingsTab('teams');
      setShowSettings(true);
    },
  });

  const handleHeaderMouseDown = useHeaderDrag();

  const title = viewTitle(activeView, projects);

  const { project: currentProject, view: currentView } = resolveCurrentProjectView(
    activeView,
    projects,
    projectViews,
  );

  // View management (add / rename / delete / reorder) for real projects only.
  const viewManager =
    activeView?.kind === 'project' && currentProject && canManageViews(currentProject)
      ? {
          projectLocalId: activeView.localId,
          activeViewLocalId: activeView.viewLocalId ?? projectViews[0]?.localId,
          onSelectView: handleSelectView,
        }
      : null;
  const openViewManager = viewManager ? () => modals.setShowViewManager(true) : undefined;

  return (
    <div
      className={cn(
        'app-root flex h-full w-full flex-col overflow-x-hidden',
        isMobile ? 'safe-top safe-bottom safe-x' : 'app-root-desktop',
      )}
    >
      {isMobile && (
        <MobileHeader
          title={title}
          activeView={activeView}
          projectViews={projectViews}
          onSelectView={handleSelectView}
          onManageViews={openViewManager}
          counts={{ isOnline, outboxCount, deadLetterCount, conflictCount }}
          onOpenOutbox={() => setShowOutbox(true)}
          onOpenConflicts={() => setShowConflicts(true)}
          currentViewKey={currentViewKey}
          onOpenDisplay={() => currentViewKey && openDisplaySheet(currentViewKey)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Desktop: sidebar is a permanent left column. Mobile: it lives in
            the slide-over drawer below instead. */}
        {!isMobile && !sidebarCollapsed && (
          <ProjectSidebar
            onOpenSearch={() => setShowCommandPalette(true)}
            onOpenSettings={() => setShowSettings(true)}
            onOpenOutbox={() => setShowOutbox(true)}
            onOpenConflicts={() => setShowConflicts(true)}
            onDragMouseDown={handleHeaderMouseDown}
          />
        )}

        {/* Content pane — a white card floating on the paper canvas. The
            desktop inspector floats inside it, on the right. */}
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 bg-[var(--color-card)]',
            !isMobile && !sidebarCollapsed &&
              'rounded-l-2xl border-l border-[var(--color-border)] shadow-[var(--shadow-card)]',
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!isMobile && (
              <DesktopHeader
                title={title}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={toggleSidebar}
                activeView={activeView}
                projectViews={projectViews}
                onSelectView={handleSelectView}
                onManageViews={openViewManager}
                currentView={currentView}
                currentViewKey={currentViewKey}
                onOpenDisplay={() => currentViewKey && openDisplaySheet(currentViewKey)}
                onQuickAdd={() => setShowQuickAdd(true)}
                onDragMouseDown={handleHeaderMouseDown}
                projectServerId={currentProject?.serverId ?? null}
              />
            )}

            <main className="vt-pane flex min-h-0 min-w-0 flex-1 flex-col">
              <MainView
                activeView={activeView}
                searchQuery={searchQuery}
                currentProject={currentProject}
                currentView={currentView}
                viewsPending={viewsPending}
              />
            </main>
          </div>

          {/* Inspector: a floating glass card on desktop. This and the mobile
              mount below are the only TaskDetail instances: a second one
              would double-register every task shortcut. */}
          {!isMobile && <TaskDetail />}
        </div>
      </div>

      {/* Update pill — floats bottom-left instead of living in the removed
          status bar. Renders nothing unless an update is available. */}
      {!isMobile && (
        <div className="fixed bottom-4 left-4 z-50">
          <UpdateBanner
            state={updaterState}
            onInstall={() => void installUpdate()}
          />
        </div>
      )}

      <ShellOverlays
        modals={modals}
        photoCaptureOpen={photoCaptureOpen}
        setPhotoCaptureOpen={setPhotoCaptureOpen}
        rambleOpen={rambleOpen}
        setRambleOpen={setRambleOpen}
        viewManager={viewManager}
      />

      {/* Mobile search overlay */}
      {isMobile && mobileSearchOpen && <MobileSearchOverlay search={search} />}

      {/* Inspector on mobile: a fixed bottom sheet, mounted after the search
          overlay so it stacks above it (both are z-50). Desktop mounts it as
          the right-hand column above; exactly one instance either way. */}
      {isMobile && <TaskDetail />}

      {/* Floating action button — hidden while a full-screen overlay (task
          detail, search, photo capture, ramble, quick-add) owns the screen. */}
      {showMobileFab({
        isMobile,
        hasSelectedTask: !!selectedTaskLocalId,
        mobileSearchOpen,
        photoCaptureOpen,
        rambleOpen,
        quickAddOpen: modals.showQuickAdd,
      }) && <MobileFab onClick={() => setShowQuickAdd(true)} />}

      <TabBar />
    </div>
  );
}
