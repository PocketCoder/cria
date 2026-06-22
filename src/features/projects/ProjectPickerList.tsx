import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { useSelectableProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { listActiveTaskCounts } from '@/db/tasks';

/**
 * Searchable project + label browser for mobile navigation. Rows show a colour
 * dot, the title, and (for projects) the open-task count. Picking one routes
 * the main view and calls `onPick` so the host (full-screen page or bottom
 * sheet) can dismiss. Shared by both Projects-nav variants.
 */
export function ProjectPickerList({
  onPick,
  autoFocus,
}: {
  onPick?: () => void;
  autoFocus?: boolean;
}) {
  const setActiveView = useUi((s) => s.setActiveView);
  const { data: projects = [] } = useSelectableProjects();
  const { data: labels = [] } = useLabels();
  const { data: counts = new Map<string, number>() } = useQuery({
    queryKey: ['taskCounts'],
    staleTime: 30_000,
    queryFn: listActiveTaskCounts,
  });

  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const fp = term ? projects.filter((p) => p.title.toLowerCase().includes(term)) : projects;
  const fl = term ? labels.filter((l) => l.title.toLowerCase().includes(term)) : labels;

  const openProject = (id: string) => {
    setActiveView({ kind: 'project', localId: id });
    onPick?.();
  };
  const openLabel = (id: string) => {
    setActiveView({ kind: 'label', localId: id });
    onPick?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-input)] px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          <input
            autoFocus={autoFocus}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects & labels"
            className="w-full bg-transparent text-base placeholder-[var(--color-muted-foreground)] focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {fp.length > 0 && (
          <>
            <p className="sticky top-0 bg-[var(--color-card)] px-2 pb-1 pt-2 text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Projects
            </p>
            <ul>
              {fp.map((p) => {
                const c = counts.get(p.localId) ?? 0;
                return (
                  <li key={p.localId}>
                    <button
                      type="button"
                      onClick={() => openProject(p.localId)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-[var(--color-accent)]/10"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-[var(--color-border)]"
                        style={p.hexColor ? { backgroundColor: p.hexColor } : undefined}
                      />
                      <span className="flex-1 truncate text-sm">{p.title}</span>
                      {c > 0 ? (
                        <span className="text-caption tabular-nums text-[var(--color-muted-foreground)]">{c}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {fl.length > 0 && (
          <>
            <p className="sticky top-0 bg-[var(--color-card)] px-2 pb-1 pt-3 text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Labels
            </p>
            <ul>
              {fl.map((l) => (
                <li key={l.localId}>
                  <button
                    type="button"
                    onClick={() => openLabel(l.localId)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-[var(--color-accent)]/10"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-[var(--color-border)]"
                      style={l.hexColor ? { backgroundColor: l.hexColor } : undefined}
                    />
                    <span className="flex-1 truncate text-sm">{l.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {fp.length === 0 && fl.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-[var(--color-muted-foreground)]">
            No matches.
          </p>
        ) : null}
      </div>
    </div>
  );
}
