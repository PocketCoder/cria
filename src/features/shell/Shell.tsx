import { useState, useEffect } from 'react';
import { OutboxModal } from '@/components/OutboxModal';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { useUi } from '@/stores/ui';
import { useProjects } from '@/queries/projects';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { TaskList } from '@/features/tasks/TaskList';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import { useOutboxCount } from '@/queries/outbox';
import { cn } from '@/lib/cn';

export function Shell() {
  const signOut = useAuth((s) => s.signOut);
  const { data: user } = useCurrentUser();
  const { data: projects = [] } = useProjects();
  const selectedId = useUi((s) => s.selectedProjectLocalId);
  const selected = projects.find((p) => p.localId === selectedId) ?? null;
  const displayName =
    user?.name?.trim() || user?.username?.trim() || 'Signed in';

  const { data: outboxCount = 0 } = useOutboxCount();
const [isOnline, setIsOnline] = useState(
      typeof navigator !== 'undefined' ? navigator.onLine : true
    );
    const [showOutbox, setShowOutbox] = useState(false);

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex select-none items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div className="text-sm font-medium tracking-tight">Cria</div>
        <div className="flex items-center gap-3">
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
{selected ? (
              <>
                <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      background:
                        selected.hexColor || 'var(--color-muted-foreground)',
                    }}
                  />
                  <h1 className="text-base font-semibold tracking-tight">
                    {selected.title}
                  </h1>
                </header>
                <div className="flex flex-1 min-w-0">
                  <TaskList project={selected} />
                  <TaskDetail />
                </div>
              </>
            ) : (
            <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Pick a project from the sidebar.
              </p>
              <p className="max-w-md text-xs text-[var(--color-muted-foreground)]">
                Create and manage your tasks offline, syncing automatically in the background.
              </p>
            </section>
          )}
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
                : 'Synced with server'}
            </span>
        </div>
        <div>
          <span>Cria Desktop v0.2.0</span>
        </div>
      </footer>
      {showOutbox && <OutboxModal onClose={() => setShowOutbox(false)} />}
    </div>
  );
}
