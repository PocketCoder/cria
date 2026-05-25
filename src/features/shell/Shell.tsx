import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/store';
import { useCurrentUser } from '@/queries/user';
import { useUi } from '@/stores/ui';
import { useProjects } from '@/queries/projects';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';

export function Shell() {
  const signOut = useAuth((s) => s.signOut);
  const { data: user } = useCurrentUser();
  const { data: projects = [] } = useProjects();
  const selectedId = useUi((s) => s.selectedProjectLocalId);
  const selected = projects.find((p) => p.localId === selectedId) ?? null;
  const displayName =
    user?.name?.trim() || user?.username?.trim() || 'Signed in';

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
              <section className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-muted-foreground)]">
                Task list lands in the next M1 chunk.
              </section>
            </>
          ) : (
            <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Pick a project from the sidebar.
              </p>
              <p className="max-w-md text-xs text-[var(--color-muted-foreground)]">
                M1 in progress — projects sync on launch, tasks next.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
