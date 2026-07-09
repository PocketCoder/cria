import { useState, useEffect, useRef, lazy, Suspense } from 'react';

import { register, unregister } from '@/tauri/globalShortcut';
import { useOnline } from '@/hooks/useOnline';
import { useShortcuts } from '@/hooks/useShortcuts';
import { LabelManagerModal } from '@/components/LabelManagerModal';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { OutboxModal } from '@/components/OutboxModal';
import { ConflictModal } from '@/components/ConflictModal';
import { UndoToasts } from '@/components/UndoToast';
import { Button } from '@/components/ui/button';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '@/stores/settings';
import { nativeNotify } from '@/utils/notify';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { useUi, type ActiveView } from '@/stores/ui';
import { getDb } from '@/db';
import { useProjects } from '@/queries/projects';
import { useProjectViews } from '@/queries/views';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { ProjectHeader } from '@/features/projects/ProjectHeader';
import { MobileViewSwitcher } from '@/features/projects/MobileViewSwitcher';
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
import { useServerVersion } from '@/queries/server';
import { SpecularTracker } from '@/components/SpecularTracker';
import { useUpdaterStore } from '@/stores/updater';
import { UpdateBanner } from '@/features/shell/UpdateBanner';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import { isMobilePlatform } from '@/lib/platform';
import { TabBar } from './TabBar';
import { Plus, Search, Settings, X, CloudOff, CloudUpload, CloudAlert, MoreHorizontal } from 'lucide-react';
import { DisplaySheet } from '@/features/shell/DisplaySheet';
import { TaskActionSheet } from '@/features/tasks/TaskActionSheet';
import { SelectionBar } from '@/features/tasks/SelectionBar';
import { useDisplay } from '@/stores/display';
import { viewKey } from '@/lib/displayConfig';
import { getCurrentWindow } from '@tauri-apps/api/window';
import pkg from '../../../package.json';

export function Shell() {
  const signOut = useAuth((s) => s.signOut);
  const { data: user } = useCurrentUser();
  const { data: projects = [] } = useProjects();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);
  const setSelectedProject = useUi((s) => s.setSelectedProject);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const photoCaptureOpen = useUi((s) => s.photoCaptureOpen);
  const setPhotoCaptureOpen = useUi((s) => s.setPhotoCaptureOpen);
  const selectedTaskLocalId = useUi((s) => s.selectedTaskLocalId);
  const openDisplaySheet = useDisplay((s) => s.openSheet);
  const currentViewKey = viewKey(activeView);
  const displayName =
    user?.name?.trim() || user?.username?.trim() || 'Signed in';

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
  }, [activeView?.kind === 'project' ? activeView?.localId : null, projectViews.length]);

  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: conflictCount = 0 } = useConflictsCount();
  const { data: deadLetterCount = 0 } = useDeadLettersCount();
  const { data: serverVersion } = useServerVersion();
  const updaterState = useUpdaterStore((s) => s.state);
  const installUpdate = useUpdaterStore((s) => s.install);
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
        const row = await db.select<any[]>(
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
  }, []);

    const [headerScrolled, setHeaderScrolled] = useState(false);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver to detect when the main content has been scrolled
  // past the top — we toggle .scrolled on the header to increase glass opacity.
  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderScrolled(!entry?.isIntersecting),
      { rootMargin: '-1px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

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
      // Cmd/Ctrl+F → focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
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
  const handleSearchFocus = () => {
    if (activeView?.kind !== 'search') {
      prevViewRef.current = activeView;
      setActiveView({ kind: 'search' });
    }
  };

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
  // Desktop-only: drag the frameless window by its header. There's no window
  // chrome to drag on mobile, so this is a no-op there.
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
      case 'label':
        return 'Label';
      case 'project': {
        const proj = projects.find((proj) => proj.localId === activeView.localId);
        return proj?.title ?? 'Project';
      }
    }
  }

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
      case 'project': {
        const project = projects.find(
          (p) => p.localId === activeView.localId,
        );
        if (!project) {
          return (
            <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Project not found.
              </p>
            </section>
          );
        }
        const currentViewLocalId =
          activeView.viewLocalId ?? projectViews[0]?.localId;
        const currentView = currentViewLocalId
          ? projectViews.find((v) => v.localId === currentViewLocalId)
          : undefined;
        return (
          <>
            <ProjectHeader
              project={project}
              views={projectViews}
              activeViewLocalId={currentViewLocalId}
              onSelectView={handleSelectView}
            />
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
                    <KanbanBoard key={currentView.localId} view={currentView} project={project} />
                  ) : currentView.viewKind === 'table' ? (
                    <TableView key={currentView.localId} project={project} view={currentView} />
                  ) : currentView.viewKind === 'gantt' ? (
                    <GanttView key={currentView.localId} project={project} view={currentView} />
                  ) : (
                    <TaskList key={currentView.localId} project={project} view={currentView} />
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
              <TaskDetail />
            </div>
          </>
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
      <SpecularTracker />
      {/* Left spacer sits behind macOS traffic lights; programmatic
          drag via getCurrentWindow().startDragging() on mousedown when
          the target isn't an interactive element. */}
      <header onMouseDown={handleHeaderMouseDown} className={cn('flex select-none items-center border-b border-[var(--color-border)] px-4 py-2', isMobile ? 'bg-[var(--color-background)]' : 'glass-surface', headerScrolled && 'scrolled')}>
        {isMobile ? (
          <div className="flex flex-1 items-center gap-2">
            <h1 className={headerScrolled ? 'nav-title-small' : 'nav-title-large'}>
              {getViewTitle()}
            </h1>
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {isMobile ? null : (
          <div className="mx-4 flex max-w-md flex-1">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onFocus={handleSearchFocus}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search tasks…  ⌘F"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] py-1.5 pl-9 pr-8 text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
              />
              {searchQuery && (
                <button
                  onClick={handleSearchClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        {isMobile ? (
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
                ? 'text-red-500'
                : 'text-amber-500';
              const total = outboxCount + deadLetterCount + conflictCount;
              const label = !isOnline
                ? 'Offline'
                : deadLetterCount > 0
                  ? `${deadLetterCount} failed to sync`
                  : outboxCount > 0
                    ? `Syncing — ${outboxCount} pending`
                    : `${conflictCount} conflicts pending`;
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
        ) : (
          <div className="flex flex-1 items-center justify-end gap-3">
            <button
              type="button"
              aria-label="Add task"
              onClick={() => setShowQuickAdd(true)}
              className="rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <Plus className="h-4 w-4" />
            </button>
            {currentViewKey && (
              <button
                type="button"
                aria-label="Display options"
                onClick={() => openDisplaySheet(currentViewKey)}
                className="rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
            <NotificationBell />
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {displayName}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Desktop: sidebar is a permanent left column. Mobile: it lives in
            the slide-over drawer below instead. */}
        {!isMobile && <ProjectSidebar />}

        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollSentinelRef} className="pointer-events-none h-px w-full shrink-0" />
          {renderMain()}
        </main>
      </div>

      {!isMobile && (
        <footer className="glass-surface flex select-none items-center justify-between border-t px-4 py-1.5 text-caption text-[var(--color-muted-foreground)]">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 rounded-full transition-colors duration-300',
                !isOnline ? 'bg-red-500 animate-pulse' : outboxCount > 0 ? 'bg-amber-500 animate-pulse' : 'bg-green-500'
              )}
            />
             <span>
               {!isOnline
                 ? 'Offline'
                 : outboxCount > 0
                 ? (
                     <button
                       className="underline"
                       onClick={() => setShowOutbox(true)}
                     >
                       Syncing… {outboxCount} pending mutation{outboxCount === 1 ? '' : 's'}
                     </button>
                   )
                 : conflictCount > 0
                 ? (
                     <button
                       className="underline"
                       onClick={() => setShowConflicts(true)}
                     >
                       {conflictCount} conflict{conflictCount === 1 ? '' : 's'} pending
                     </button>
                   )
                 : 'Synced with server'}
             </span>
             {deadLetterCount > 0 && (
               <button
                 className="ml-2 flex items-center gap-1 text-red-500 underline"
                 onClick={() => setShowOutbox(true)}
               >
                 <span className="h-2 w-2 rounded-full bg-red-500" />
                 {deadLetterCount} failed to sync
               </button>
             )}
           </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              aria-label="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            <UpdateBanner
              state={updaterState}
              onInstall={() => void installUpdate()}
            />
            <span>
              Cria {pkg.version}
              {serverVersion ? <span className="ml-2 text-[var(--color-muted-foreground)]">· {serverVersion}</span> : null}
            </span>
          </div>
        </footer>
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
      {showLabelManager && (
        <LabelManagerModal onClose={() => setShowLabelManager(false)} />
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

      {/* Floating action button — Todoist's round "+" anchored above the tab
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
            className="fab fixed right-5 z-40 flex h-14 w-14 items-center justify-center"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.75rem)' }}
          >
            <Plus className="h-7 w-7" strokeWidth={2.5} />
          </button>
        )}

      <TabBar />
      </div>
  );
}
