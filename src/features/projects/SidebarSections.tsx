import { useEffect, useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, ListFilter, Pencil, Trash2, Settings } from 'lucide-react';
import { useProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { useSavedFilters } from '@/queries/savedFilters';
import { deleteSavedFilter } from '@/api/savedFilters';
import type { SavedFilter } from '@/db/savedFilters';
import { useUi } from '@/stores/ui';
import { createProject, updateProject, deleteProject } from '@/db/projects';
import { createLabel, updateLabel, deleteLabel } from '@/db/labels';
import { listActiveTaskCounts } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { cn } from '@/lib/cn';
import { useOnline } from '@/hooks/useOnline';
import { useOutboxCount } from '@/queries/outbox';
import { useDeadLettersCount } from '@/queries/outboxRows';
import { useConflictsCount } from '@/queries/conflicts';
import { useLastSyncTime } from '@/queries/syncState';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { Project } from '@/domain/project';
import { childProjectsOf, useProjectExpand } from './projectTree';
import { LabelRow, NavItem, ProjectRow } from './SidebarRows';
import { computeDropPosition, computeSyncLine, visibleProjectList } from './sidebarLogic';

const SECTION_HEADING =
  'px-2 pb-1 pt-3 group-label text-[var(--color-muted-foreground)]';

/* ────────────────────────── saved filters ─────────────────────────── */

export type FilterModalState = { mode: 'create' } | { mode: 'edit'; filter: SavedFilter } | null;

/**
 * Saved filters (Vikunja pseudo-projects). Header always shows (the + is the
 * only create entry point).
 */
export function SavedFiltersSection({
  onNewFilter,
  onEditFilter,
}: {
  onNewFilter: () => void;
  onEditFilter: (filter: SavedFilter) => void;
}) {
  const { data: projects = [] } = useProjects();
  const { data: savedFilters = [] } = useSavedFilters();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between pr-1">
        <p className={SECTION_HEADING}>Filters</p>
        <button
          type="button"
          onClick={onNewFilter}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          aria-label="New filter"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-0.5">
        {savedFilters.map((f) => {
          const pseudo = projects.find((p) => p.serverId === -f.serverId - 1);
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
                <ContextMenuItem onClick={() => onEditFilter(f)}>
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
  );
}

/* ────────────────────────── labels ─────────────────────────── */

export function LabelsSection() {
  const { data: labels = [] } = useLabels();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);

  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelTitle, setNewLabelTitle] = useState('');
  const [labelEditingId, setLabelEditingId] = useState<string | null>(null);
  const [labelEditingTitle, setLabelEditingTitle] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const labelCreatingRef = useRef(false);

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

  return (
    <div className="mb-1">
      <p className={SECTION_HEADING}>Labels</p>
      <div className="space-y-0.5">
        {labels.map((l) => (
          <LabelRow
            key={l.localId}
            label={l}
            isSelected={activeView?.kind === 'label' && activeView.localId === l.localId}
            isEditing={labelEditingId === l.localId}
            editingTitle={labelEditingTitle}
            onSelect={() => setActiveView({ kind: 'label', localId: l.localId })}
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
                if (activeView?.kind === 'label' && activeView.localId === l.localId)
                  setActiveView(null);
              } catch (err) {
                console.error('[sidebar] deleteLabel failed:', err);
              }
            }}
          />
        ))}
        {creatingLabel ? (
          <input
            aria-label="New label name"
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
  );
}

/* ────────────────────────── projects ─────────────────────────── */

export function ProjectsSection({ onShare }: { onShare: (project: Project) => void }) {
  const { data: projects = [], isLoading, isError, error } = useProjects();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);

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

  /* ── project drag-to-reorder ───────────────────────────── */
  const draggedIdRef = useRef<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const visibleProjects = visibleProjectList(projects);

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

    const newPosition = computeDropPosition(visibleProjects, draggedId, dropIndex);
    if (newPosition === null) return;

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

  const renderTree = (parentId: string | null, depth: number): React.ReactNode[] =>
    childrenOf(parentId).flatMap((p) => {
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
          isSelected={activeView?.kind === 'project' && activeView.localId === p.localId}
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
          onShare={() => onShare(p)}
          onDelete={async () => {
            try {
              await deleteProject(p.localId);
              if (activeView?.kind === 'project' && activeView.localId === p.localId)
                setActiveView(null);
            } catch (err) {
              console.error('[sidebar] deleteProject failed:', err);
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

  return (
    <div className="mt-2">
      <header className="flex items-center justify-between pr-1">
        <p className="px-2.5 pb-1.5 pt-2 group-label text-[var(--color-muted-foreground)]">
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
          aria-label="New project name"
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
        <ul className="space-y-0.5">{renderTree(null, 0)}</ul>
      )}

      {isError ? (
        <p className="mt-2 px-2 text-xs text-[var(--color-warning-text)]">
          Couldn't refresh
          {error instanceof Error ? `: ${error.message}` : ''}.
        </p>
      ) : null}
    </div>
  );
}

/* ────────────────────────── footer ─────────────────────────── */

export function SidebarFooter({
  onOpenSettings,
  onOpenOutbox,
  onOpenConflicts,
}: {
  onOpenSettings?: () => void;
  onOpenOutbox?: () => void;
  onOpenConflicts?: () => void;
}) {
  // Sync line (sidebar footer). Priority: offline > dead letters > conflicts
  // > draining outbox > idle.
  const online = useOnline();
  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: deadLetterCount = 0 } = useDeadLettersCount();
  const { data: conflictCount = 0 } = useConflictsCount();
  const { data: lastSync } = useLastSyncTime();

  const syncLine = useMemo(() => {
    const line = computeSyncLine({ online, outboxCount, deadLetterCount, conflictCount, lastSync });
    const onClick =
      line.target === 'outbox'
        ? onOpenOutbox
        : line.target === 'conflicts'
          ? onOpenConflicts
          : undefined;
    return { ...line, onClick };
  }, [online, outboxCount, deadLetterCount, conflictCount, lastSync, onOpenOutbox, onOpenConflicts]);

  return (
    <footer className="flex-none border-t border-[var(--color-border)] px-3 pb-2.5 pt-2">
      <button
        type="button"
        onClick={syncLine.onClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] text-[var(--color-muted-foreground)]',
          syncLine.onClick && 'hover:bg-[var(--color-muted)]',
        )}
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', syncLine.dot)} />
        <span className="truncate">{syncLine.text}</span>
        {syncLine.action && (
          <span className="ml-auto font-medium text-[var(--color-primary)]">
            {syncLine.action}
          </span>
        )}
      </button>
      <div className="mt-0.5 flex items-center justify-between pr-0.5">
        <span className="text-[10.5px] font-bold tracking-[-0.03em] text-[var(--color-muted-foreground)]">
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
              <Settings className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
