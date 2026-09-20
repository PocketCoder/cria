import { useEffect, useState, useRef, useMemo, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { useSavedFilters } from '@/queries/savedFilters';
import { deleteSavedFilter } from '@/api/savedFilters';
import { ShareProjectModal } from '@/features/projects/ShareProjectModal';
import { SavedFilterModal } from '@/features/smart-views/SavedFilterModal';
import type { SavedFilter } from '@/db/savedFilters';
import { useUi } from '@/stores/ui';
import { createProject, updateProject, deleteProject } from '@/db/projects';
import { createLabel, updateLabel, deleteLabel } from '@/db/labels';
import { listActiveTaskCounts } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { cn } from '@/lib/cn';
import { childProjectsOf, useProjectExpand } from './projectTree';
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Calendar,
  CalendarDays,
  Star,
  Inbox,
  ListFilter,
  Share2,
  Palette,
  ChevronRight,
  ChevronDown,
  Search,
  Settings,
} from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';
import { useOutboxCount } from '@/queries/outbox';
import { useDeadLettersCount } from '@/queries/outboxRows';
import { useConflictsCount } from '@/queries/conflicts';
import { useLastSyncTime } from '@/queries/syncState';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import type { Project } from '@/domain/project';
import type { Label } from '@/domain/label';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

/* ────────────────────────── shared nav item ─────────────────────────── */

function NavItem({
  icon: Icon,
  label,
  isSelected,
  onClick,
  count,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isSelected: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13.5px]',
        'hover:bg-[var(--color-muted)]',
        isSelected &&
          'bg-[var(--color-inverse)] font-medium text-[var(--color-inverse-foreground)] dark:bg-[oklch(30%_0.012_265)] dark:text-[var(--color-foreground)]',
      )}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          isSelected ? '' : 'text-[var(--color-muted-foreground)]',
        )}
      />
      <span className="truncate">{label}</span>
      {count != null && (
        <span
          className={cn(
            'ml-auto text-[11.5px] tabular-nums',
            isSelected ? 'opacity-70' : 'text-[var(--color-muted-foreground)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ────────────────────────── sidebar component ─────────────────────────── */

function timeAgo(d: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * Sidebar with smart views at the top (Today / Upcoming / Labels) and
 * project CRUD below. Clicking a view updates `activeView` in the UI
 * store, which the Shell reads to decide what to render in the main pane.
 */
export function ProjectSidebar({
  showSmartViews = true,
  onOpenSearch,
  onOpenSettings,
  onOpenOutbox,
  onOpenConflicts,
  onDragMouseDown,
}: {
  showSmartViews?: boolean;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onOpenOutbox?: () => void;
  onOpenConflicts?: () => void;
  onDragMouseDown?: (e: React.MouseEvent) => void;
} = {}) {
  const { data: projects = [], isLoading, isError, error } =
    useProjects();
  const { data: labels = [] } = useLabels();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);

  // Sync line (sidebar footer). Priority: offline > dead letters > conflicts
  // > draining outbox > idle.
  const online = useOnline();
  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: deadLetterCount = 0 } = useDeadLettersCount();
  const { data: conflictCount = 0 } = useConflictsCount();
  const { data: lastSync } = useLastSyncTime();

  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['taskCounts'] });
      }),
    [qc],
  );
  const { data: taskCounts = new Map<string, number>() } = useQuery({
    queryKey: ['taskCounts'],
    staleTime: 30_000,
    queryFn: listActiveTaskCounts,
  });

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const creatingRef = useRef(false);

  const { data: savedFilters = [] } = useSavedFilters();
  const [filterModal, setFilterModal] = useState<
    { mode: 'create' } | { mode: 'edit'; filter: SavedFilter } | null
  >(null);
  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelTitle, setNewLabelTitle] = useState('');
  const [labelEditingId, setLabelEditingId] = useState<string | null>(null);
  const [labelEditingTitle, setLabelEditingTitle] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const labelCreatingRef = useRef(false);

  /* ── project drag-to-reorder ───────────────────────────── */
  const draggedIdRef = useRef<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Negative server ids are Vikunja pseudo-projects: -1 Favorites (also
  // filtered by title for rows pulled before the sync-side guard), < -1
  // saved filters (rendered in the Filters section, not the tree).
  const visibleProjects = projects.filter(
    (p) => (p.serverId == null || p.serverId > 0) && p.title !== 'Favorites',
  );

  // Sub-project tree (built client-side from parentLocalId — see projectTree).
  const visibleIds = useMemo(
    () => new Set(visibleProjects.map((p) => p.localId)),
    [visibleProjects],
  );
  const childrenOf = (parentId: string | null) =>
    childProjectsOf(visibleProjects, visibleIds, parentId);
  const { isOpen: isProjectOpen, toggle: toggleProjectOpen } = useProjectExpand();

  const handleDragStart = (localId: string) => {
    draggedIdRef.current = localId;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    const draggedId = draggedIdRef.current;
    draggedIdRef.current = null;
    if (!draggedId) return;

    const fromIndex = visibleProjects.findIndex((p) => p.localId === draggedId);
    if (fromIndex === -1 || fromIndex === dropIndex) return;

    const reordered = [...visibleProjects];
    const removed = reordered.splice(fromIndex, 1);
    if (removed.length === 0) return;
    const item = removed[0]!;
    reordered.splice(dropIndex, 0, item);

    const before: Project | undefined = reordered[dropIndex - 1];
    const after: Project | undefined = reordered[dropIndex + 1];
    const beforePos: number = before?.position ?? 0;
    const afterPos: number = after?.position ?? (beforePos + 2048);
    const newPosition: number = (beforePos + afterPos) / 2;

    try {
      await updateProject(draggedId, { position: newPosition });
    } catch (err) {
      console.error('[sidebar] drag-reorder failed:', err);
    }
  };

  const handleDragEnd = () => {
    draggedIdRef.current = null;
    setDragOverIndex(null);
  };

  const handleCreateLabel = async () => {
    if (labelCreatingRef.current) return;
    const title = newLabelTitle.trim();
    if (!title) {
      setCreatingLabel(false);
      setNewLabelTitle('');
      return;
    }
    labelCreatingRef.current = true;
    setLabelBusy(true);
    try {
      const label = await createLabel({ title });
      setActiveView({ kind: 'label', localId: label.localId });
    } catch (err) {
      console.error('[sidebar] createLabel failed:', err);
    } finally {
      labelCreatingRef.current = false;
      setLabelBusy(false);
      setCreatingLabel(false);
      setNewLabelTitle('');
    }
  };

  const handleCreate = async () => {
    if (creatingRef.current) return;
    const title = newTitle.trim();
    if (!title) {
      setCreating(false);
      setNewTitle('');
      return;
    }
    creatingRef.current = true;
    setBusy(true);
    try {
      const project = await createProject({ title });
      setActiveView({ kind: 'project', localId: project.localId });
    } catch (err) {
      console.error('[sidebar] createProject failed:', err);
    } finally {
      creatingRef.current = false;
      setBusy(false);
      setCreating(false);
      setNewTitle('');
    }
  };

  const handleRenameSave = async (localId: string) => {
    const title = editingTitle.trim();
    if (!title) {
      setEditingId(null);
      return;
    }
    try {
      await updateProject(localId, { title });
    } catch (err) {
      console.error('[sidebar] updateProject failed:', err);
    } finally {
      setEditingId(null);
      setEditingTitle('');
    }
  };

  const syncLine = useMemo(() => {
    if (!online) {
      return {
        dot: 'bg-[var(--color-warning)]',
        text: outboxCount > 0 ? `Offline — ${outboxCount} saved locally` : 'Offline',
        action: null as string | null,
        onClick: onOpenOutbox,
      };
    }
    if (deadLetterCount > 0) {
      return {
        dot: 'bg-[var(--color-destructive)]',
        text: `${deadLetterCount} ${deadLetterCount === 1 ? 'change' : 'changes'} wouldn't send`,
        action: 'Review',
        onClick: onOpenOutbox,
      };
    }
    if (conflictCount > 0) {
      return {
        dot: 'bg-[var(--color-destructive)]',
        text: `${conflictCount} ${conflictCount === 1 ? 'conflict' : 'conflicts'}`,
        action: 'Resolve',
        onClick: onOpenConflicts,
      };
    }
    if (outboxCount > 0) {
      return {
        dot: 'bg-[var(--color-primary)]',
        text: `Sending ${outboxCount} ${outboxCount === 1 ? 'change' : 'changes'}…`,
        action: null as string | null,
        onClick: onOpenOutbox,
      };
    }
    return {
      dot: 'bg-[var(--color-success)]',
      text: lastSync ? `All synced · ${timeAgo(lastSync)}` : 'All synced',
      action: null as string | null,
      onClick: undefined as (() => void) | undefined,
    };
  }, [online, outboxCount, deadLetterCount, conflictCount, lastSync, onOpenOutbox, onOpenConflicts]);

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col bg-[var(--color-background)]">
      {/* 44px traffic-light strip — the window drag region */}
      <div
        onMouseDown={onDragMouseDown}
        className="flex h-11 flex-none select-none items-center gap-2 px-4"
      >
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
      </div>

      {/* Search → command palette */}
      <div className="flex-none px-3 pb-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex w-full items-center gap-2 rounded-lg bg-[var(--color-muted)] px-2.5 py-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <span className="text-[11px] opacity-70">⌘K</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {/* ── Smart Views (hidden in mobile sheet — only shows projects + labels) ── */}
        {showSmartViews && (
          <div className="flex flex-col gap-1">
            <NavItem
              icon={Calendar}
              label="Today"
              isSelected={activeView?.kind === 'today'}
              onClick={() => setActiveView({ kind: 'today' })}
            />
            <NavItem
              icon={CalendarDays}
              label="Upcoming"
              isSelected={activeView?.kind === 'upcoming'}
              onClick={() => setActiveView({ kind: 'upcoming' })}
            />
            <NavItem
              icon={Inbox}
              label="Inbox"
              isSelected={activeView?.kind === 'inbox'}
              onClick={() => setActiveView({ kind: 'inbox' })}
            />
            <NavItem
              icon={Star}
              label="Favorites"
              isSelected={activeView?.kind === 'favorites'}
              onClick={() => setActiveView({ kind: 'favorites' })}
            />
          </div>
        )}

        {/* ── Saved filters (Vikunja pseudo-projects) ── */}
        {/* Header always shows (the + is the only create entry point). */}
        {showSmartViews && (
          <div className="mb-1">
            <div className="flex items-center justify-between pr-1">
              <p className="px-2.5 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
                Filters
              </p>
              <button
                type="button"
                onClick={() => setFilterModal({ mode: 'create' })}
                className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                aria-label="New filter"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {savedFilters.map((f) => {
                const pseudo = projects.find(
                  (p) => p.serverId === -f.serverId - 1,
                );
                return (
                  <ContextMenu key={f.serverId}>
                    <ContextMenuTrigger asChild>
                      <div>
                        <NavItem
                          icon={ListFilter}
                          label={f.title}
                          isSelected={
                            !!pseudo &&
                            activeView?.kind === 'project' &&
                            activeView.localId === pseudo.localId
                          }
                          onClick={() => {
                            if (!pseudo) return;
                            setActiveView({ kind: 'project', localId: pseudo.localId });
                          }}
                        />
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => setFilterModal({ mode: 'edit', filter: f })}
                      >
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="text-[var(--color-destructive)]"
                        onClick={() => {
                          void deleteSavedFilter(f.serverId).catch((err) =>
                            console.error('[sidebar] deleteSavedFilter failed:', err),
                          );
                        }}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Labels ── */}
        <div className="mb-1">
          <p className="px-2.5 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
            Labels
          </p>
          <div className="space-y-0.5">
            {labels.map((l) => (
              <LabelRow
                key={l.localId}
                label={l}
                isSelected={
                  activeView?.kind === 'label' &&
                  activeView.localId === l.localId
                }
                isEditing={labelEditingId === l.localId}
                editingTitle={labelEditingTitle}
                onSelect={() =>
                  setActiveView({ kind: 'label', localId: l.localId })
                }
                onStartRename={() => {
                  setLabelEditingId(l.localId);
                  setLabelEditingTitle(l.title);
                }}
                onChangeRename={setLabelEditingTitle}
                onSaveRename={async () => {
                  const title = labelEditingTitle.trim();
                  if (!title) {
                    setLabelEditingId(null);
                    return;
                  }
                  try {
                    await updateLabel(l.localId, { title });
                  } catch (err) {
                    console.error('[sidebar] updateLabel failed:', err);
                  } finally {
                    setLabelEditingId(null);
                    setLabelEditingTitle('');
                  }
                }}
                onCancelRename={() => {
                  setLabelEditingId(null);
                  setLabelEditingTitle('');
                }}
                onDelete={async () => {
                  try {
                    await deleteLabel(l.localId);
                    if (
                      activeView?.kind === 'label' &&
                      activeView.localId === l.localId
                    )
                      setActiveView(null);
                  } catch (err) {
                    console.error('[sidebar] deleteLabel failed:', err);
                  }
                }}
              />
            ))}
            {creatingLabel ? (
              <input
                type="text"
                autoFocus
                value={newLabelTitle}
                disabled={labelBusy}
                onChange={(e) => setNewLabelTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateLabel();
                  } else if (e.key === 'Escape') {
                    setCreatingLabel(false);
                    setNewLabelTitle('');
                  }
                }}
                placeholder="New label name…"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              />
            ) : (
              <button
                type="button"
                onClick={() => setCreatingLabel(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                {labelBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                New label
              </button>
            )}
          </div>
        </div>

        <div className="my-2 border-t border-[var(--color-border)]" />

        {/* ── Projects ── */}
        <div className="mt-2">
          <header className="flex items-center justify-between pr-1">
            <p className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
              Projects
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="New project"
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
            </button>
          </header>

          {creating ? (
            <input
              type="text"
              autoFocus
              value={newTitle}
              disabled={busy}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={() => void handleCreate()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreate();
                } else if (e.key === 'Escape') {
                  setCreating(false);
                  setNewTitle('');
                }
              }}
              placeholder="New project name…"
              className="mx-2.5 mb-1 w-[calc(100%-1.25rem)] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          ) : null}

          {isLoading && projects.length === 0 ? (
            <p className="px-2.5 py-1 text-xs text-[var(--color-muted-foreground)]">
              Loading…
            </p>
          ) : projects.length === 0 && !creating ? (
            <p className="px-2.5 py-1 text-xs text-[var(--color-muted-foreground)]">
              No projects yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {(function renderTree(parentId: string | null, depth: number): React.ReactNode[] {
                return childrenOf(parentId).flatMap((p) => {
                  const i = visibleProjects.indexOf(p);
                  const kids = childrenOf(p.localId);
                  const open = isProjectOpen(p.localId);
                  return [
                    <ProjectRow
                      key={p.localId}
                      project={p}
                      depth={depth}
                      hasChildren={kids.length > 0}
                      expanded={open}
                      onToggleExpand={() => toggleProjectOpen(p.localId)}
                      taskCount={taskCounts.get(p.localId) ?? 0}
                      isSelected={
                        activeView?.kind === 'project' &&
                        activeView.localId === p.localId
                      }
                      isEditing={editingId === p.localId}
                      editingTitle={editingTitle}
                      isDragOver={dragOverIndex === i}
                      onSelect={() =>
                        setActiveView({
                          kind: 'project',
                          localId: p.localId,
                        })
                      }
                      onStartRename={() => {
                        setEditingId(p.localId);
                        setEditingTitle(p.title);
                      }}
                      onChangeRename={setEditingTitle}
                      onSaveRename={() => void handleRenameSave(p.localId)}
                      onCancelRename={() => {
                        setEditingId(null);
                        setEditingTitle('');
                      }}
                      onShare={() => setShareProject(p)}
                      onDelete={async () => {
                        try {
                          await deleteProject(p.localId);
                          if (
                            activeView?.kind === 'project' &&
                            activeView.localId === p.localId
                          )
                            setActiveView(null);
                        } catch (err) {
                          console.error(
                            '[sidebar] deleteProject failed:',
                            err,
                          );
                        }
                      }}
                      onDragStart={() => handleDragStart(p.localId)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDrop={(e) => void handleDrop(e, i)}
                      onDragEnd={handleDragEnd}
                    />,
                    ...(open && kids.length > 0 ? renderTree(p.localId, depth + 1) : []),
                  ];
                });
              })(null, 0)}
            </ul>
          )}

          {isError ? (
            <p className="mt-2 px-2 text-xs text-[var(--color-warning)]">
              Couldn't refresh
              {error instanceof Error ? `: ${error.message}` : ''}.
            </p>
          ) : null}
        </div>
      </nav>

      <footer className="flex-none border-t border-[var(--color-border)] px-3 pb-2.5 pt-2">
        <button
          type="button"
          onClick={syncLine.onClick}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] text-[var(--color-muted-foreground)]',
            syncLine.onClick && 'hover:bg-[var(--color-muted)]',
          )}
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', syncLine.dot)} />
          <span className="truncate">{syncLine.text}</span>
          {syncLine.action && (
            <span className="ml-auto font-medium text-[var(--color-primary)]">
              {syncLine.action}
            </span>
          )}
        </button>
        <div className="mt-0.5 flex items-center justify-between pr-0.5">
          <span className="text-[10.5px] text-[var(--color-muted-foreground)]">
            Cria
          </span>
          <div className="flex items-center gap-0.5">
            <NotificationBell />
            {onOpenSettings && (
              <button
                type="button"
                aria-label="Settings"
                onClick={onOpenSettings}
                className="rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </footer>

      {filterModal && (
        <SavedFilterModal
          existing={filterModal.mode === 'edit' ? filterModal.filter : null}
          onClose={() => setFilterModal(null)}
        />
      )}
      {shareProject && (
        <ShareProjectModal
          project={shareProject}
          onClose={() => setShareProject(null)}
        />
      )}
    </aside>
  );
}

const PROJECT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#000000',
];

function ProjectRow({
  project,
  depth,
  hasChildren,
  expanded,
  onToggleExpand,
  taskCount,
  isSelected,
  isEditing,
  editingTitle,
  isDragOver,
  onSelect,
  onStartRename,
  onChangeRename,
  onSaveRename,
  onCancelRename,
  onShare,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  project: Project;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  taskCount: number;
  isSelected: boolean;
  isEditing: boolean;
  editingTitle: string;
  isDragOver: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onChangeRename: (v: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onShare: () => void;
  onDelete: () => Promise<void> | void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

  if (isEditing) {
    return (
      <li>
        <input
          type="text"
          autoFocus
          value={editingTitle}
          onChange={(e) => onChangeRename(e.target.value)}
          onBlur={onSaveRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSaveRename();
            } else if (e.key === 'Escape') {
              onCancelRename();
            }
          }}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
      </li>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          draggable={!isEditing}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          className={cn(
            'group relative',
            isDragOver && 'border-t-2 border-[var(--color-primary)]',
          )}
        >
          <div
            className="flex items-center"
            style={depth > 0 ? { paddingLeft: depth * 14 } : undefined}
          >
            {/* Expand/collapse toggle — own button so it never nests inside the
                row's select button. A spacer keeps childless rows aligned. */}
            {hasChildren ? (
              <button
                type="button"
                aria-label={expanded ? 'Collapse sub-projects' : 'Expand sub-projects'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="h-5 w-4 shrink-0" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={onSelect}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-[6px] pr-8 text-left text-[13.5px]',
                'hover:bg-[var(--color-muted)]',
                isSelected && 'bg-[var(--color-inverse)] font-medium text-[var(--color-inverse-foreground)] dark:bg-[oklch(30%_0.012_265)] dark:text-[var(--color-foreground)]',
              )}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: project.hexColor || 'var(--color-muted-foreground)',
                }}
              />
              <span className="truncate">{project.title}</span>
              {project.isArchived ? (
                <span
                  className={cn(
                    'ml-auto text-footnote uppercase',
                    isSelected ? 'opacity-70' : 'text-[var(--color-muted-foreground)]',
                  )}
                >
                  archived
                </span>
              ) : taskCount > 0 ? (
                <span
                  className={cn(
                    'ml-auto text-footnote',
                    isSelected ? 'opacity-70' : 'text-[var(--color-muted-foreground)]',
                  )}
                >
                  {taskCount}
                </span>
              ) : null}
            </button>
          </div>

          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${project.title}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-muted-foreground)]',
                  'opacity-0 transition-opacity hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)] group-hover:opacity-100',
                  menuOpen && 'opacity-100',
                )}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="right" sideOffset={4} className="w-44 p-1">
              {confirmDelete ? (
                <div className="space-y-1.5 p-1.5 text-xs">
                  <p>Delete "{project.title}"?</p>
                  <p className="text-footnote text-[var(--color-muted-foreground)]">
                    Tasks inside the project are removed too.
                  </p>
                  <div className="flex justify-end gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md px-2 py-1 hover:bg-[var(--color-muted)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onDelete();
                        setMenuOpen(false);
                        setConfirmDelete(false);
                      }}
                      className="rounded-md bg-[var(--color-destructive)] px-2 py-1 font-medium text-[var(--color-destructive-foreground)] hover:opacity-90"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="text-xs">
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-muted)]"
                      onClick={() => {
                        onStartRename();
                        setMenuOpen(false);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-muted)]"
                      onClick={() => setColorOpen(!colorOpen)}
                    >
                      <Palette className="h-3.5 w-3.5" />
                      Color
                    </button>
                    {colorOpen && (
                      <div className="flex flex-wrap gap-1 px-2 py-1.5">
                        {PROJECT_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={async () => {
                              await updateProject(project.localId, {
                                hexColor: c === project.hexColor ? null : c,
                              });
                              setMenuOpen(false);
                              setColorOpen(false);
                            }}
                            className={cn(
                              'h-5 w-5 rounded-full border-2 transition-all',
                              c === project.hexColor
                                ? 'border-[var(--color-foreground)] scale-110'
                                : 'border-transparent hover:scale-110',
                            )}
                            style={{ background: c }}
                          />
                        ))}
                        <input
                          type="color"
                          value={project.hexColor ?? '#000000'}
                          onChange={(e) => {
                            updateProject(project.localId, { hexColor: e.target.value });
                            setMenuOpen(false);
                            setColorOpen(false);
                          }}
                          className="h-5 w-5 cursor-pointer rounded-full border-0 overflow-hidden"
                          title="Custom color"
                        />
                        <button
                          onClick={async () => {
                            await updateProject(project.localId, { hexColor: null });
                            setMenuOpen(false);
                            setColorOpen(false);
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] text-footnote text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/10"
                          title="Remove color"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </li>
                </ul>
              )}
            </PopoverContent>
          </Popover>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onStartRename}>
          <span className="flex items-center gap-2">
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => { onShare(); }}>
          <span className="flex items-center gap-2">
            <Share2 className="h-3.5 w-3.5" />
            Share
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => { onDelete(); }}>
          <span className="flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function LabelRow({
  label,
  isSelected,
  isEditing,
  editingTitle,
  onSelect,
  onStartRename,
  onChangeRename,
  onSaveRename,
  onCancelRename,
  onDelete,
}: {
  label: Label;
  isSelected: boolean;
  isEditing: boolean;
  editingTitle: string;
  onSelect: () => void;
  onStartRename: () => void;
  onChangeRename: (v: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isEditing) {
    return (
      <li>
        <input
          type="text"
          autoFocus
          value={editingTitle}
          onChange={(e) => onChangeRename(e.target.value)}
          onBlur={onSaveRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSaveRename();
            } else if (e.key === 'Escape') {
              onCancelRename();
            }
          }}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
      </li>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li className="group relative">
          <button
            type="button"
            onClick={onSelect}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-[6px] pr-8 text-left text-[13.5px]',
              'hover:bg-[var(--color-muted)]',
              isSelected && 'bg-[var(--color-inverse)] font-medium text-[var(--color-inverse-foreground)] dark:bg-[oklch(30%_0.012_265)] dark:text-[var(--color-foreground)]',
            )}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: label.hexColor || 'var(--color-muted-foreground)',
              }}
            />
            <span className="truncate">{label.title}</span>
          </button>

          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${label.title}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-muted-foreground)]',
                  'opacity-0 transition-opacity hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)] group-hover:opacity-100',
                  menuOpen && 'opacity-100',
                )}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="right" sideOffset={4} className="w-44 p-1">
              {confirmDelete ? (
                <div className="space-y-1.5 p-1.5 text-xs">
                  <p>Delete "{label.title}"?</p>
                  <p className="text-footnote text-[var(--color-muted-foreground)]">
                    Removed from all tasks.
                  </p>
                  <div className="flex justify-end gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md px-2 py-1 hover:bg-[var(--color-muted)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onDelete();
                        setMenuOpen(false);
                        setConfirmDelete(false);
                      }}
                      className="rounded-md bg-[var(--color-destructive)] px-2 py-1 font-medium text-[var(--color-destructive-foreground)] hover:opacity-90"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="text-xs">
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-muted)]"
                      onClick={() => {
                        onStartRename();
                        setMenuOpen(false);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </li>
                </ul>
              )}
            </PopoverContent>
          </Popover>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onStartRename}>
          <span className="flex items-center gap-2">
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => { onDelete(); }}>
          <span className="flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
