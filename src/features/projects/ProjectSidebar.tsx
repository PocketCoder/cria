import { useProjects } from '@/queries/projects';
import { useUi } from '@/stores/ui';
import { cn } from '@/lib/cn';

export function ProjectSidebar() {
  const { data: projects = [], isLoading, isFetching, isError, error } =
    useProjects();
  const selected = useUi((s) => s.selectedProjectLocalId);
  const select = useUi((s) => s.setSelectedProject);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-card)]">
      <header className="flex items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <span>Projects</span>
        {isFetching ? <span aria-live="polite">syncing…</span> : null}
      </header>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading && projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-[var(--color-muted-foreground)]">
            Loading…
          </p>
        ) : projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-[var(--color-muted-foreground)]">
            No projects yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {projects.map((p) => {
              const isSelected = p.localId === selected;
              return (
                <li key={p.localId}>
                  <button
                    type="button"
                    onClick={() => select(p.localId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                      'hover:bg-[var(--color-muted)]',
                      isSelected && 'bg-[var(--color-muted)] font-medium',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: p.hexColor || 'var(--color-muted-foreground)',
                      }}
                    />
                    <span className="truncate">{p.title}</span>
                    {p.isArchived ? (
                      <span className="ml-auto text-[10px] uppercase text-[var(--color-muted-foreground)]">
                        archived
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {isError ? (
          <p className="mt-2 px-2 text-xs text-[var(--color-warning)]">
            Couldn't refresh
            {error instanceof Error ? `: ${error.message}` : ''}.
          </p>
        ) : null}
      </nav>
    </aside>
  );
}
