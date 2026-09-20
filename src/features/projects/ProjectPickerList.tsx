import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Star, ChevronRight, ChevronDown, Inbox, SlidersHorizontal, Plus } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { useSelectableProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { listActiveTaskCounts } from '@/db/tasks';
import { childProjectsOf, useProjectExpand } from './projectTree';
import { useDisplay } from '@/stores/display';
import { viewKey } from '@/lib/displayConfig';
import { useInboxTasks } from '@/queries/smartViews';

/**
 * The mobile Browse screen: a searchable project + label browser. Inbox /
 * Favourites / Filters are pinned rows at the top; PROJECTS renders as a
 * collapsible tree; LABELS as a wrapping chip row. Picking one routes the
 * main view.
 */
export function ProjectPickerList({
  onPick,
  autoFocus,
}: {
  onPick?: () => void;
  autoFocus?: boolean;
}) {
  const setActiveView = useUi((s) => s.setActiveView);
  const activeView = useUi((s) => s.activeView);
  const openSheet = useDisplay((s) => s.openSheet);
  const { data: projects = [] } = useSelectableProjects();
  const { data: labels = [] } = useLabels();
  const { data: counts = new Map<string, number>() } = useQuery({
    queryKey: ['taskCounts'],
    staleTime: 30_000,
    queryFn: listActiveTaskCounts,
  });
  const { data: inboxGroups = [] } = useInboxTasks();
  const inboxCount = inboxGroups.reduce(
    (n, g) => n + g.tasks.filter((t) => !t.done).length,
    0,
  );

  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const fp = term ? projects.filter((p) => p.title.toLowerCase().includes(term)) : projects;
  const fl = term ? labels.filter((l) => l.title.toLowerCase().includes(term)) : labels;

  // Sub-project tree for the unfiltered list (search stays flat).
  const visibleIds = new Set(projects.map((p) => p.localId));
  const { isOpen, toggle } = useProjectExpand();

  const openProject = (id: string) => {
    setActiveView({ kind: 'project', localId: id });
    onPick?.();
  };
  const openLabel = (id: string) => {
    setActiveView({ kind: 'label', localId: id });
    onPick?.();
  };
  const openFavorites = () => {
    setActiveView({ kind: 'favorites' });
    onPick?.();
  };
  const openInbox = () => {
    setActiveView({ kind: 'inbox' });
    onPick?.();
  };

  const projectButton = (p: (typeof projects)[number]) => {
    const c = counts.get(p.localId) ?? 0;
    return (
      <button
        type="button"
        onClick={() => openProject(p.localId)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-[9px] text-left hover:bg-[var(--color-accent)]/10"
      >
        <span
          className="h-[7px] w-[7px] shrink-0 rounded-full border border-[var(--color-border)]"
          style={p.hexColor ? { backgroundColor: p.hexColor } : undefined}
        />
        <span className="flex-1 truncate text-sm">{p.title}</span>
        {c > 0 ? (
          <span className="text-caption tabular-nums text-[var(--color-muted-foreground)]">{c}</span>
        ) : null}
      </button>
    );
  };

  const renderProjectTree = (parentId: string | null, depth: number): React.ReactNode[] =>
    childProjectsOf(projects, visibleIds, parentId).flatMap((p) => {
      const kids = childProjectsOf(projects, visibleIds, p.localId);
      const open = isOpen(p.localId);
      return [
        <li key={p.localId}>
          <div className="flex items-center" style={depth > 0 ? { paddingLeft: depth * 32 } : undefined}>
            {kids.length > 0 ? (
              <button
                type="button"
                aria-label={open ? 'Collapse sub-projects' : 'Expand sub-projects'}
                onClick={() => toggle(p.localId)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--color-muted-foreground)]"
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="h-7 w-7 shrink-0" aria-hidden="true" />
            )}
            {projectButton(p)}
          </div>
        </li>,
        ...(open && kids.length > 0 ? renderProjectTree(p.localId, depth + 1) : []),
      ];
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-[11px] bg-[var(--color-input)] px-3 py-2">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!term && (
          <ul className="mb-2 divide-y divide-[var(--color-border)]">
            <li>
              <button
                type="button"
                onClick={openInbox}
                className="flex w-full items-center gap-3 py-[13px] text-left"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <Inbox className="h-5 w-5 text-[var(--color-primary)]" />
                </span>
                <span className="flex-1 truncate text-[15px]">Inbox</span>
                {inboxCount > 0 ? (
                  <span className="min-w-[20px] rounded-full bg-[var(--color-inverse)] px-1.5 py-0.5 text-center text-[10.5px] font-semibold tabular-nums text-[var(--color-inverse-foreground)]">
                    {inboxCount > 99 ? '99+' : inboxCount}
                  </span>
                ) : null}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={openFavorites}
                className="flex w-full items-center gap-3 py-[13px] text-left"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <Star className="h-5 w-5 text-[var(--color-primary)]" />
                </span>
                <span className="flex-1 truncate text-[15px]">Favourites</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => openSheet(viewKey(activeView) ?? 'today')}
                className="flex w-full items-center gap-3 py-[13px] text-left"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <SlidersHorizontal className="h-5 w-5 text-[var(--color-primary)]" />
                </span>
                <span className="flex-1 truncate text-[15px]">Filters</span>
              </button>
            </li>
          </ul>
        )}

        {fp.length > 0 && (
          <>
            <div className="flex items-center justify-between pr-1">
              <p className="px-2 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
                Projects
              </p>
              <Plus className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
            </div>
            <ul>
              {term
                ? fp.map((p) => (
                    <li key={p.localId} className="flex items-center">
                      {projectButton(p)}
                    </li>
                  ))
                : renderProjectTree(null, 0)}
            </ul>
          </>
        )}

        {fl.length > 0 && (
          <>
            <p className="px-2 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
              Labels
            </p>
            <div className="flex flex-wrap gap-2 px-2">
              {fl.map((l) => (
                <button
                  key={l.localId}
                  type="button"
                  onClick={() => openLabel(l.localId)}
                  className="flex items-center gap-2 rounded-[10px] bg-[var(--color-background)] px-[13px] py-[9px] text-[14.5px] hover:bg-[var(--color-muted)]"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-[var(--color-border)]"
                    style={l.hexColor ? { backgroundColor: l.hexColor } : undefined}
                  />
                  <span className="truncate">{l.title}</span>
                </button>
              ))}
            </div>
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
