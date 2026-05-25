import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';

export function LandingScreen() {
  const signOut = useAuth((s) => s.signOut);
  const status = useAuth((s) => s.status);
  const {
    data: user,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useCurrentUser();

  const displayName =
    user?.name?.trim() || user?.username?.trim() || (isLoading ? null : '—');
  const serverUrl =
    status.kind === 'authenticated' ? status.credentials.serverUrl : '';

  return (
    <main className="flex min-h-full flex-col">
      <header className="flex select-none items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div className="text-sm font-medium tracking-tight">Cria</div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
        {isLoading && !user ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Loading account…
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Signed in to <code className="font-mono">{serverUrl}</code> as
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {displayName ?? '…'}
            </h1>
            {isError ? (
              <p className="mt-2 text-xs text-[var(--color-warning)]">
                Couldn't refresh from the server
                {error instanceof Error ? `: ${error.message}` : ''}.
              </p>
            ) : null}
            <p className="mt-4 max-w-md text-center text-xs text-[var(--color-muted-foreground)]">
              M0 done. M1 will replace this with the three-pane shell and load
              your projects.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
