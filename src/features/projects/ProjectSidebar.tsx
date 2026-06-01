import { useState, useRef, type ComponentType } from 'react';
import { useProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { useUi } from '@/stores/ui';
import { createProject, updateProject, deleteProject } from '@/db/projects';
import { createLabel, updateLabel, deleteLabel } from '@/db/labels';
import { cn } from '@/lib/cn';
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
} from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import type { Project } from '@/domain/project';
import type { Label } from '@/domain/label';

/* ────────────────────────── shared nav item ─────────────────────────── */

function NavItem({
  icon: Icon,
  label,
  isSelected,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
        'hover:bg-[var(--color-muted)]',
        isSelected && 'bg-[var(--color-muted)] font-medium',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ──────────────────────── sidebar component ─────────────────────────── */

/**
 * Sidebar with smart views at the top (Today / Upcoming / Labels) and
 * project CRUD below. Clicking a view updates `activeView` in the UI
 * store, which the Shell reads to decide what to render in the main pane.
 */
export function ProjectSidebar() {
  const { data: projects = [], isLoading, isFetching, isError, error } =
    useProjects();
  const { data: labels = [] } = useLabels();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const creatingRef = useRef(false);

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

  return (
    <aside className="flex h-full w-52 flex-col border-r border-[var(--color-border)] bg-[var(--color-card)]">
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {/* ── Smart Views ── */}
        <div className="mb-1">
          <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Smart Views
          </p>
          <div className="space-y-0.5">
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
              icon={Star}
              label="Favorites"
              isSelected={activeView?.kind === 'favorites'}
              onClick={() => setActiveView({ kind: 'favorites' })}
            />
            <NavItem
              icon={Inbox}
              label="Inbox"
              isSelected={activeView?.kind === 'inbox'}
              onClick={() => setActiveView({ kind: 'inbox' })}
            />
            <>
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
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
            </>
          </div>
        </div>

        <div className="my-2 border-t border-[var(--color-border)]" />

        {/* ── Projects ── */}
        <div>
          <header className="flex items-center justify-between px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            <span>Projects</span>
            {isFetching ? (
              <span aria-live="polite">syncing…</span>
            ) : null}
          </header>

          {isLoading && projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--color-muted-foreground)]">
              Loading…
            </p>
          ) : projects.length === 0 && !creating ? (
            <p className="px-2 py-1 text-xs text-[var(--color-muted-foreground)]">
              No projects yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {/* Filter out Vikunja's virtual "Favorites" container project.
                  The server returns it as a real project when any project is
                  favorited. We identify it by title since its server_id isn't
                  predictable. */}
              {projects.filter((p) => p.title !== 'Favorites').map((p) => (
                <ProjectRow
                  key={p.localId}
                  project={p}
                  isSelected={
                    activeView?.kind === 'project' &&
                    activeView.localId === p.localId
                  }
                  isEditing={editingId === p.localId}
                  editingTitle={editingTitle}
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
                />
              ))}
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

      <footer className="border-t border-[var(--color-border)] px-2 py-2">
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
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            New project
          </button>
        )}
      </footer>
    </aside>
  );
}

function ProjectRow({
  project,
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
  project: Project;
  isSelected: boolean;
  isEditing: boolean;
  editingTitle: string;
  onSelect: () => void;
  onStartRename: () => void;
  onChangeRename: (v: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onDelete: () => Promise<void> | void;
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
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-left text-sm',
          'hover:bg-[var(--color-muted)]',
          isSelected && 'bg-[var(--color-muted)] font-medium',
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
          <span className="ml-auto text-[10px] uppercase text-[var(--color-muted-foreground)]">
            archived
          </span>
        ) : null}
      </button>

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
              <p className="text-[10px] text-[var(--color-muted-foreground)]">
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
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-left text-sm',
          'hover:bg-[var(--color-muted)]',
          isSelected && 'bg-[var(--color-muted)] font-medium',
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
              <p className="text-[10px] text-[var(--color-muted-foreground)]">
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
  );
}
