import { useState, useEffect, useRef, lazy, Suspense } from 'react';

import { register, unregister } from '@/tauri/globalShortcut';
import { useOnline } from '@/hooks/useOnline';
import { OutboxModal } from '@/components/OutboxModal';
import { ConflictModal } from '@/components/ConflictModal';
import { UndoToasts } from '@/components/UndoToast';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '@/stores/settings';
import { nativeNotify } from '@/utils/notify';
import { useUi, type ActiveView } from '@/stores/ui';
import { getDb } from '@/db';
import { useProjects } from '@/queries/projects';
import { useProjectViews } from '@/queries/views';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { MobileViewSwitcher } from '@/features/projects/MobileViewSwitcher';
import { ViewSwitcher } from '@/features/projects/ViewSwitcher';
import { ViewFilterButton } from '@/features/projects/ViewFilterButton';
import { ProjectPickerList } from '@/features/projects/ProjectPickerList';
import { TaskList } from '@/features/tasks/TaskList';
// Heavy, conditionally-rendered project views — code-split out of the startup
// bundle. Only loaded when the active project view actually selects one. The
// default views (TaskList, SmartViews) stay eager so first paint isn't gated
// on a chunk fetch.
const KanbanBoard = lazy(() =>
  import('@/features/kanban/KanbanBoard').then((m) => ({ default: m.KanbanBoard })),
);
const TableView = lazy(() =>
  import('@/features/table/TableView').then((m) => ({ default: m.TableView })),
);
const GanttView = lazy(() =>
  import('@/features/gantt/GanttView').then((m) => ({ default: m.GanttView })),
);
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import {
  TodayView,
  UpcomingView,
  LabelView,
  InboxView,
  FavoritesView,
} from '@/features/smart-views/SmartViews';
import { SearchView } from '@/features/search/SearchView';
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
const CommandPalette = lazy(() =>
  import('@/components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const SettingsModal = lazy(() =>
  import('@/components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
import { useOutboxCount } from '@/queries/outbox';
import { useDeadLettersCount } from '@/queries/outboxRows';
import { useConflictsCount } from '@/queries/conflicts';
import { useShortcuts } from '@/hooks/useShortcuts';
import { LabelManagerModal } from '@/components/LabelManagerModal';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useUpdaterStore } from '@/stores/updater';
import { UpdateBanner } from '@/features/shell/UpdateBanner';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import { isMobilePlatform } from '@/lib/platform';
import { TabBar } from './TabBar';
import { Plus, Search, Settings, CloudOff, CloudUpload, CloudAlert, MoreHorizontal, SlidersHorizontal, PanelLeft } from 'lucide-react';
import { DisplaySheet } from '@/features/shell/DisplaySheet';
import { TaskActionSheet } from '@/features/tasks/TaskActionSheet';
import { SelectionBar } from '@/features/tasks/SelectionBar';
import { useDisplay } from '@/stores/display';
import { viewKey } from '@/lib/displayConfig';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { format } from 'date-fns';

export function Shell() {
  const { data: projects = [] } = useProjects();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);
  const setSelectedProject = useUi((s) => s.setSelectedProject);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const photoCaptureOpen = useUi((s) => s.photoCaptureOpen);
  const setPhotoCaptureOpen = useUi((s) => s.setPhotoCaptureOpen);
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

  // Resolve the initial view when opening a project without a viewLocalId.
  // Must preserve selectedTaskLocalId — the palette may have set both
  // activeView and selectedTaskLocalId atomically, and calling
  // setActiveView here would clear the selection and close the detail card.
  useEffect(() => {
    const av = activeView;
    if (av?.kind === 'project' && !av.viewLocalId && projectViews.length > 0) {
      const stored = localStorage.getItem(`cria:projectView:${av.localId}`);
      const targetId = stored && projectViews.some((v) => v.localId === stored)
        ? stored
        : projectViews[0]!.localId;
      const selected = useUi.getState().selectedTaskLocalId;
      useUi.setState({
        activeView: { kind: 'project', localId: av.localId, viewLocalId: targetId },
        selectedTaskLocalId: selected,
      });
    }
  }, [activeView, projectViews]); // guarded: re-runs are no-ops once viewLocalId is set

  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: conflictCount = 0 } = useConflictsCount();
  const { data: deadLetterCount = 0 } = useDeadLettersCount();
  const updaterState = useUpdaterStore((s) => s.state);
  const runUpdaterCheck = useUpdaterStore((s) => s.runCheck);
  const installUpdate = useUpdaterStore((s) => s.install);
  // Auto-check for updates on mount (silent failure is fine).
  useEffect(() => { void runUpdaterCheck(true); }, [runUpdaterCheck]);
  const isOnline = useOnline();


  // Notify only on sync conflicts (not routine outbox drain)
  const prevConflicts = useRef<number>(conflictCount);

  useEffect(() => {
    if (prevConflicts.current === 0 && conflictCount > 0) {
      nativeNotify('Conflicts detected', `${conflictCount} conflict(s) need your attention`);
    }
    prevConflicts.current = conflictCount;
  }, [conflictCount]);

  // Tray icon quick-add
  useEffect(() => {
    const unlisten = listen('tray-quick-add', () => {
      setShowQuickAdd(true);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Sync tray visibility from persisted store on startup
  useEffect(() => {
    const visible = useSettings.getState().trayIconEnabled;
    invoke('set_tray_visible', { visible }).catch(() => {});
  }, []);

  // Deep‑link handling (vikunja://task/<id> or project)
  useEffect(() => {
    const unlisten = listen<string>('tauri://url', async (event) => {
      const url = event.payload;
      try {
        const matches = url.match(/vikunja:\/\/(task|project)\/(\d+)/);
        if (!matches) return;
        const [, type, serverIdStr] = matches;
        const serverId = parseInt(serverIdStr!, 10);
        const db = await getDb();
        const row = await db.select<{ local_id: string }[]>(
          `SELECT local_id FROM ${type}s WHERE server_id = ? LIMIT 1`,
          [serverId]
        );
        const localId = row[0]?.local_id;
        if (localId) {
          if (type === 'project') {
            setSelectedProject(localId);
          } else {
            setSelectedTask(localId);
          }
        }
      } catch (e) {
        console.error('Deep link handling error', e);
      }
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setSelectedProject, setSelectedTask]);

  const [showOutbox, setShowOutbox] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'teams' | undefined>(undefined);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  /* ── mobile layout ────────────────────────────────────── */
  // On phones the three-pane shell collapses to a single pane: the sidebar
  // opens as a bottom sheet via TabBar, the list fills the screen, and
  // TaskDetail renders full-screen (see TaskDetail). Desktop is unaffected.
  const isMobile = useIsMobile();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  /* ── search ───────────────────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevViewRef = useRef<ActiveView | null>(null);

  // Register global shortcut Cmd+Shift+A for Quick Add
  useEffect(() => {
    const shortcut = 'CommandOrControl+Shift+A';
    register(shortcut, () => setShowQuickAdd(true)).catch((e) => console.error('Failed to register shortcut', e));
    return () => {
      unregister(shortcut).catch((e) => console.error('Failed to unregister shortcut', e));
    };
  }, []);

  // Dev‑only keyboard shortcut (⌘+Shift+A) — Tauri global shortcut covers
  // production; this handler is just so the dev webview gets it too.
  useEffect(() => {
    if (import.meta.env.MODE !== 'development') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'A') {
        setShowQuickAdd(true);
      }
      // Cmd/Ctrl+F → open the command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Fixed Vikunja shortcut set (⌘K palette, ⌘E sidebar, g-sequences,
  // task-detail keys via the shortcut bus). See lib/shortcuts.ts.
  const [showLabelManager, setShowLabelManager] = useState(false);
  useShortcuts({
    switchView: (kind) => {
      const target = projectViews.find((v) => v.viewKind === kind);
      if (target) handleSelectView(target.localId);
    },
    openQuickSearch: () => setShowCommandPalette((v) => !v),
    openLabelManager: () => setShowLabelManager(true),
    openTeams: () => {
      setSettingsTab('teams');
      setShowSettings(true);
    },
  });

  /* ── search handlers ──────────────────────────────────── */
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setSearchQuery(v);
    if (v.trim() && activeView?.kind !== 'search') {
      prevViewRef.current = activeView;
      setActiveView({ kind: 'search' });
    } else if (!v.trim() && activeView?.kind === 'search') {
      setActiveView(prevViewRef.current);
      prevViewRef.current = null;
    }
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    setActiveView(prevViewRef.current);
    prevViewRef.current = null;
    setMobileSearchOpen(false);
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleSearchClear();
    }
  };

  /* ── window drag ──────────────────────────────────────── */
  // Desktop-only: drag the frameless window by its sidebar drag strip. There's
  // no window chrome to drag on mobile, so this is a no-op there.
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (isMobilePlatform()) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, button, a, [role="button"], textarea, select')) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  function getViewTitle(): string {
    if (!activeView) return 'Cria';
    switch (activeView.kind) {
      case 'today': return 'Today';
      case 'upcoming': return 'Upcoming';
      case 'inbox': return 'Inbox';
      case 'favorites': return 'Favorites';
      case 'search': return 'Search';
      case 'browse': return 'Browse';
      case 'label':
        return 'Label';
      case 'project': {
        const proj = projects.find((proj) => proj.localId === activeView.localId);
        return proj?.title ?? 'Project';
      }
    }
  }

  const currentProject =
    activeView?.kind === 'project'
      ? projects.find((p) => p.localId === activeView.localId)
      : undefined;
  const currentViewLocalId =
    activeView?.kind === 'project'
      ? (activeView.viewLocalId ?? projectViews[0]?.localId)
      : undefined;
  const currentView = currentViewLocalId
    ? projectViews.find((v) => v.localId === currentViewLocalId)
    : undefined;

  function renderMain() {
    if (!activeView) {
      return (
        <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Pick a project from the sidebar.
          </p>
          <p className="max-w-md text-xs text-[var(--color-muted-foreground)]">
            Create and manage your tasks offline, syncing automatically in the
            background.
          </p>
        </section>
      );
    }

    switch (activeView.kind) {
      case 'today':
        return <TodayView />;
      case 'upcoming':
        return <UpcomingView />;
      case 'label':
        return <LabelView labelLocalId={activeView.localId} />;
      case 'favorites':
        return <FavoritesView />;
      case 'inbox':
        return <InboxView />;
      case 'search':
        return <SearchView query={searchQuery} />;
      case 'browse':
        return <ProjectPickerList />;
      case 'project': {
        if (!currentProject) {
          return (
            <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Project not found.
              </p>
            </section>
          );
        }
        return (
          <div className="flex min-h-0 min-w-0 flex-1">
            {currentView ? (
              // Kanban/Table/Gantt are lazy-loaded — wrap in Suspense so the
              // chunk fetch shows a subtle placeholder instead of an empty
              // pane. TaskList is eager but harmless to nest here.
              <Suspense
                fallback={
                  <section className="flex flex-1 items-center justify-center p-8">
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      Loading…
                    </p>
                  </section>
                }
              >
                {/* Key each view by its localId so switching views remounts the
                    component instead of reusing per-view state (filter, collapsed
                    columns, edit drafts) seeded in useState initializers. */}
                {currentView.viewKind === 'kanban' ? (
                  <KanbanBoard key={currentView.localId} view={currentView} project={currentProject} />
                ) : currentView.viewKind === 'table' ? (
                  <TableView key={currentView.localId} project={currentProject} view={currentView} />
                ) : currentView.viewKind === 'gantt' ? (
                  <GanttView key={currentView.localId} project={currentProject} view={currentView} />
                ) : (
                  <TaskList key={currentView.localId} project={currentProject} view={currentView} />
                )}
              </Suspense>
            ) : viewsPending ? (
              <section className="flex flex-1 items-center justify-center p-8">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Loading views…
                </p>
              </section>
            ) : (
              <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No views available for this project.
                </p>
              </section>
            )}
          </div>
        );
      }
    }
  }

  return (
    <div
      className={cn(
        'app-root flex h-full w-full flex-col overflow-x-hidden',
        isMobile && 'safe-top safe-bottom safe-x',
      )}
    >
      {isMobile && (
        <header className="flex select-none items-center border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2">
          <div className="flex flex-1 items-center gap-2">
            <h1 className="nav-title-large">
              {getViewTitle()}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {activeView?.kind === 'project' && (
              <MobileViewSwitcher
                views={projectViews}
                activeViewLocalId={activeView.viewLocalId ?? projectViews[0]?.localId}
                onSelect={handleSelectView}
              />
            )}
            {/* Sync status — surfaces what the desktop footer shows, so an
                iOS user can actually see (and reach) a stalled outbox. Hidden
                when everything's fine; tap opens the OutboxModal (or the
                ConflictModal when conflicts are the only thing pending). */}
            {(() => {
              const needsAttention =
                !isOnline || outboxCount > 0 || deadLetterCount > 0 || conflictCount > 0;
              if (!needsAttention) return null;
              const onlyConflicts =
                conflictCount > 0 && outboxCount === 0 && deadLetterCount === 0 && isOnline;
              const Icon = !isOnline
                ? CloudOff
                : deadLetterCount > 0 || conflictCount > 0
                  ? CloudAlert
                  : CloudUpload;
              const tone = !isOnline || deadLetterCount > 0
                ? 'text-[var(--color-destructive)]'
                : 'text-[var(--color-warning)]';
              const total = outboxCount + deadLetterCount + conflictCount;
              const label = !isOnline
                ? outboxCount > 0 ? `Offline — ${outboxCount} saved locally` : 'Offline'
                : deadLetterCount > 0
                  ? `${deadLetterCount} ${deadLetterCount === 1 ? 'change' : 'changes'} wouldn't send`
                  : outboxCount > 0
                    ? `Sending ${outboxCount} ${outboxCount === 1 ? 'change' : 'changes'}…`
                    : `${conflictCount} ${conflictCount === 1 ? 'conflict' : 'conflicts'}`;
              return (
                <button
                  type="button"
                  aria-label={label}
                  title={label}
                  onClick={() => (onlyConflicts ? setShowConflicts(true) : setShowOutbox(true))}
                  className={cn(
                    'relative rounded-md p-2 transition-colors hover:bg-[var(--color-muted)]',
                    tone,
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {total > 0 ? (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-semibold leading-[1.1rem] text-white">
                      {total > 99 ? '99+' : total}
                    </span>
                  ) : null}
                </button>
              );
            })()}
            <button
              type="button"
              aria-label="Search"
              onClick={() => {
                setMobileSearchOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 100);
              }}
              className="rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <Search className="h-5 w-5" />
            </button>
            {currentViewKey && (
              <button
                type="button"
                aria-label="Display options"
                onClick={() => openDisplaySheet(currentViewKey)}
                className="rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            )}
            <NotificationBell />
            <button
              type="button"
              aria-label="Settings"
              onClick={() => setShowSettings(true)}
              className="-mr-1 rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>
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

        {/* Content pane — a white card floating on the paper canvas. */}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col bg-[var(--color-card)]',
            !isMobile && !sidebarCollapsed && 'rounded-l-xl border-l border-[var(--color-border)]',
          )}
        >
          {!isMobile && (
            <header className="flex flex-none flex-wrap items-end justify-between gap-x-4 gap-y-3 px-10 pb-4 pt-11">
              <div className="flex min-w-[200px] flex-1 items-end gap-3">
                {sidebarCollapsed && (
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    aria-label="Show sidebar"
                    title="Show sidebar (⌘E)"
                    className="mb-1.5 shrink-0 rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                  >
                    <PanelLeft className="h-[18px] w-[18px]" />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                <h1 className="truncate text-[32px] font-semibold leading-none tracking-[-0.035em] text-[var(--color-foreground)]">
                  {getViewTitle()}
                </h1>
                <p className="mt-1.5 truncate text-sm text-[var(--color-muted-foreground)]">
                  {format(new Date(), 'EEEE d MMMM')}
                </p>
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {activeView?.kind === 'project' && (
                  <ViewSwitcher
                    views={projectViews}
                    activeViewLocalId={activeView.viewLocalId ?? projectViews[0]?.localId}
                    onSelect={handleSelectView}
                  />
                )}
                {activeView?.kind === 'project' && currentView && (
                  <ViewFilterButton view={currentView} />
                )}
                {currentViewKey && (
                  <button
                    type="button"
                    onClick={() => openDisplaySheet(currentViewKey)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-muted)] dark:border-[oklch(31%_0.008_265)]"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filter
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowQuickAdd(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-inverse)] px-3 py-1.5 text-xs font-medium text-[var(--color-inverse-foreground)] hover:opacity-90"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Add task
                </button>
              </div>
            </header>
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            {renderMain()}
          </main>
        </div>

        {/* Inspector — permanent right-hand column on desktop. This and the
            mobile mount below are the only TaskDetail instances: a second
            one would double-register every task shortcut. */}
        {!isMobile && <TaskDetail />}
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

      {showOutbox && <OutboxModal onClose={() => setShowOutbox(false)} />}
      {showConflicts && <ConflictModal onClose={() => setShowConflicts(false)} />}
      <DisplaySheet />
      <TaskActionSheet />
      <SelectionBar />
      {/* Lazy modals — null fallback is fine; they animate in on open, so a
          brief invisible gap while the chunk loads is imperceptible. */}
      {showQuickAdd && (
        <Suspense fallback={null}>
          <QuickAddModal onClose={() => setShowQuickAdd(false)} />
        </Suspense>
      )}
      {photoCaptureOpen && (
        <Suspense fallback={null}>
          <PhotoTaskCreator onClose={() => setPhotoCaptureOpen(false)} />
        </Suspense>
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            initialTab={settingsTab}
            onClose={() => {
              setShowSettings(false);
              setSettingsTab(undefined);
            }}
          />
        </Suspense>
      )}
      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onOpenQuickAdd={() => setShowQuickAdd(true)}
            onOpenSettings={() => setShowSettings(true)}
          />
        </Suspense>
      )}
      {showLabelManager && (
        <LabelManagerModal onClose={() => setShowLabelManager(false)} />
      )}
      <UndoToasts />

      {/* Mobile search overlay */}
      {isMobile && mobileSearchOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)] safe-top">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search tasks…"
                autoFocus
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
      )}

      {/* Inspector on mobile: a fixed bottom sheet, mounted after the search
          overlay so it stacks above it (both are z-50). Desktop mounts it as
          the right-hand column above; exactly one instance either way. */}
      {isMobile && <TaskDetail />}

      {/* Floating action button — ink-filled circle anchored above the tab
          bar. Mobile only; hidden while a full-screen overlay (task detail,
          search, photo capture, quick-add) owns the screen. */}
      {isMobile &&
        !selectedTaskLocalId &&
        !mobileSearchOpen &&
        !photoCaptureOpen &&
        !showQuickAdd && (
          <button
            type="button"
            aria-label="Add task"
            onClick={() => setShowQuickAdd(true)}
            className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-inverse)] text-[var(--color-inverse-foreground)] shadow-[0_8px_22px_-6px_rgba(0,0,0,0.4)]"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.75rem)' }}
          >
            <Plus className="h-7 w-7" strokeWidth={2.5} />
          </button>
        )}

      <TabBar />
    </div>
  );
}
