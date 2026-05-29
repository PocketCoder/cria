import { useState, useEffect, useRef } from 'react';

import { register, unregister } from '@/tauri/globalShortcut';
import { OutboxModal } from '@/components/OutboxModal';
import { ConflictModal } from '@/components/ConflictModal';
import { UndoToasts } from '@/components/UndoToast';
import { Button } from '@/components/ui/button';
import { listen } from '@tauri-apps/api/event';
import { isEnabled, enable, disable } from '@/tauri/autostart';
import { nativeNotify } from '@/utils/notify';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { useUi, type ActiveView } from '@/stores/ui';
import { getDb } from '@/db';
import { useProjects } from '@/queries/projects';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { TaskList } from '@/features/tasks/TaskList';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import {
  TodayView,
  UpcomingView,
  LabelView,
  FavoritesView,
} from '@/features/smart-views/SmartViews';
import { SearchView } from '@/features/search/SearchView';
import { QuickAddModal } from '@/components/QuickAddModal';
import { useOutboxCount } from '@/queries/outbox';
import { useConflictsCount } from '@/queries/conflicts';
import { cn } from '@/lib/cn';
import { Search, X } from 'lucide-react';
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
  const displayName =
    user?.name?.trim() || user?.username?.trim() || 'Signed in';

  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: conflictCount = 0 } = useConflictsCount();
  const [isOnline, setIsOnline] = useState(
      typeof navigator !== 'undefined' ? navigator.onLine : true
    );
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);

  // Track previous counts to fire notifications only on transition
  const prevOutbox = useRef<number>(outboxCount);
  const prevConflicts = useRef<number>(conflictCount);

  // Notification side‑effects
  useEffect(() => {
    if (prevOutbox.current === 0 && outboxCount > 0) {
      nativeNotify('Sync pending', `${outboxCount} mutation(s) awaiting upload`);
    }
    if (prevConflicts.current === 0 && conflictCount > 0) {
      nativeNotify('Conflicts detected', `${conflictCount} conflict(s) need your attention`);
    }
    prevOutbox.current = outboxCount;
    prevConflicts.current = conflictCount;
  }, [outboxCount, conflictCount]);

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

    const [showOutbox, setShowOutbox] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  /* ── search ───────────────────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevViewRef = useRef<ActiveView | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);


  // Register global shortcut Cmd+Shift+A for Quick Add
  useEffect(() => {
    const shortcut = 'CommandOrControl+Shift+A';
    register(shortcut, () => setShowQuickAdd(true)).catch((e) => console.error('Failed to register shortcut', e));
    return () => {
      unregister(shortcut).catch((e) => console.error('Failed to unregister shortcut', e));
    };
  }, []);

  // Load initial autostart status
  useEffect(() => {
    (async () => {
      try {
        const enabled = await isEnabled();
        setAutostartEnabled(enabled);
      } catch (e) {
        console.error('Failed to read autostart status', e);
      }
    })();
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
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleSearchClear();
    }
  };

  /* ── window drag ──────────────────────────────────────── */
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, button, a, [role="button"], textarea, select')) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

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
        return (
          <>
            <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background:
                    project.hexColor || 'var(--color-muted-foreground)',
                }}
              />
              <h1 className="text-base font-semibold tracking-tight">
                {project.title}
              </h1>
            </header>
            <div className="flex min-h-0 min-w-0 flex-1">
              <TaskList project={project} />
              <TaskDetail />
            </div>
          </>
        );
      }
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-x-hidden">
      {/* Left spacer sits behind macOS traffic lights; programmatic
          drag via getCurrentWindow().startDragging() on mousedown when
          the target isn't an interactive element. */}
      <header onMouseDown={handleHeaderMouseDown} className="flex select-none items-center border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex-1" />
        <div className="mx-4 flex flex-1 max-w-md">
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
        <div className="flex flex-1 items-center justify-end gap-3">
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {displayName}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ProjectSidebar />

        <main className="flex min-w-0 flex-1 flex-col">
          {renderMain()}
        </main>
      </div>

      <footer className="flex select-none items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-background)] px-4 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
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
          {/* Autostart toggle */}
<button
             onClick={async () => {
               try {
                 const enabled = await isEnabled();
                 if (enabled) {
                   await disable();
                 } else {
                   await enable();
                 }
                 // Refresh status after toggling
                 setAutostartEnabled(!(await isEnabled()));
               } catch (e) {
                 console.error('Autostart toggle failed', e);
               }
             }}
             className="text-xs text-[var(--color-muted-foreground)] underline"
           >
             Autostart: {autostartEnabled ? 'On' : 'Off'}
           </button>
        </div>
        <div className="flex items-center gap-3">
          {/* Update banner moved to App.tsx so it's visible pre-auth
              too — see the comment there. Keeping just the version
              label here. */}
          <span>Cria {pkg.version}</span>
        </div>
      </footer>
{showOutbox && <OutboxModal onClose={() => setShowOutbox(false)} />}
      {showConflicts && <ConflictModal onClose={() => setShowConflicts(false)} />}
      {showQuickAdd && <QuickAddModal onClose={() => setShowQuickAdd(false)} />}
      <UndoToasts />
      </div>
  );
}
