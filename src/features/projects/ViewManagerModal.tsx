import { useId, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  ChartGantt,
  GripVertical,
  List,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  SquareKanban,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjectViews } from '@/queries/views';
import { createView, deleteView, reindexViews, updateView } from '@/db/views';
import { useOptimisticOrder } from '@/lib/useOptimisticOrder';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import {
  VIEW_KINDS,
  VIEW_KIND_LABELS,
  canReorderViews,
  newViewTitle,
  planViewReorder,
  viewAfterDelete,
  viewDeleteBlocker,
  viewKindHint,
  viewLabel,
} from '@/lib/viewManagement';
import type { ProjectView, ViewKind } from '@/domain/view';
import { ViewSettingsPanel } from './ViewSettingsPanel';

const KIND_ICONS: Record<ViewKind, typeof List> = {
  list: List,
  gantt: ChartGantt,
  table: Table2,
  kanban: SquareKanban,
};

const BLOCKER_TEXT = {
  'last-view': 'A project needs at least one view',
  placeholder: 'Available once this project has synced',
} as const;

interface ViewManagerModalProps {
  projectLocalId: string;
  activeViewLocalId: string | undefined;
  onSelectView: (viewLocalId: string) => void;
  onClose: () => void;
}

/**
 * Manage a project's views: rename, delete (never the last one), drag to
 * reorder, add a new list / gantt / table / board view, and edit each view's
 * filter (plus, for boards, manual vs filter-based buckets) from its settings
 * panel.
 */
export function ViewManagerModal({
  projectLocalId,
  activeViewLocalId,
  onSelectView,
  onClose,
}: ViewManagerModalProps) {
  const isMobile = useIsMobile();
  const { data: views = [], isPending } = useProjectViews(projectLocalId);
  const [error, setError] = useState<string | null>(null);

  const baseIds = useMemo(() => views.map((v) => v.localId), [views]);
  const [orderedIds, setOrderedIds] = useOptimisticOrder(baseIds);
  const orderedViews = useMemo(() => {
    const byId = new Map(views.map((v) => [v.localId, v]));
    return orderedIds.flatMap((id) => byId.get(id) ?? []);
  }, [views, orderedIds]);

  const reorderable = canReorderViews(orderedViews);
  const hasPlaceholder = orderedViews.some((v) => v.placeholder);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Touch: long-press the handle to grab, matching the list/board reorder.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeId = String(active.id);
    const reorder = planViewReorder(orderedViews, activeId, String(over.id));
    if (!reorder) return;
    setOrderedIds(reorder.orderedIds);
    setError(null);
    try {
      if (reorder.plan.type === 'midpoint') {
        await updateView(activeId, { position: reorder.plan.position });
      } else {
        await reindexViews(reorder.orderedIds);
      }
    } catch (err) {
      console.error('[views] reorder failed:', err);
      setError('Couldn’t save the new order.');
    }
  };

  const handleRename = async (view: ProjectView, draft: string) => {
    const title = draft.trim();
    if (!title || title === view.title) return;
    setError(null);
    try {
      await updateView(view.localId, { title });
    } catch (err) {
      console.error('[views] rename failed:', err);
      setError('Couldn’t rename the view.');
    }
  };

  const handleDelete = async (view: ProjectView) => {
    setError(null);
    // Switch away first so the pane never renders a deleted view.
    if (view.localId === activeViewLocalId) {
      const next = viewAfterDelete(orderedViews, view.localId);
      if (next) onSelectView(next);
    }
    try {
      await deleteView(view.localId);
    } catch (err) {
      console.error('[views] delete failed:', err);
      setError('Couldn’t delete the view.');
    }
  };

  const handleCreate = async (title: string, kind: ViewKind) => {
    setError(null);
    try {
      await createView(projectLocalId, { title, viewKind: kind });
    } catch (err) {
      console.error('[views] create failed:', err);
      setError('Couldn’t add the view.');
    }
  };

  return (
    <ModalDialog label="Manage views" onClose={onClose}>
      <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <BackdropDismiss onDismiss={onClose} />
        <div className="relative flex max-h-[80dvh] w-11/12 max-w-md flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
          <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Manage views</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-3">
            {isPending ? (
              <p className="py-4 text-center text-sm text-[var(--color-muted-foreground)]">
                Loading…
              </p>
            ) : (
              <>
                {hasPlaceholder && (
                  <p className="mb-2 px-2 text-xs text-[var(--color-muted-foreground)]">
                    The default views can be renamed, reordered or deleted once this
                    project has synced.
                  </p>
                )}
                <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
                  <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1" aria-label="Views">
                      {orderedViews.map((view) => (
                        <SortableViewRow
                          key={view.localId}
                          view={view}
                          compact={!isMobile}
                          reorderable={reorderable}
                          deleteBlocker={viewDeleteBlocker(orderedViews, view.localId)}
                          onRename={(draft) => handleRename(view, draft)}
                          onDelete={() => handleDelete(view)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                <AddViewRow compact={!isMobile} onCreate={handleCreate} />
              </>
            )}
            {error && (
              <p role="alert" className="mt-2 px-2 text-xs text-[var(--color-destructive)]">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}

function SortableViewRow({
  view,
  compact,
  reorderable,
  deleteBlocker,
  onRename,
  onDelete,
}: {
  view: ProjectView;
  compact: boolean;
  reorderable: boolean;
  deleteBlocker: ReturnType<typeof viewDeleteBlocker>;
  onRename: (draft: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelId = useId();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: view.localId, disabled: !reorderable || editing || confirming });

  const label = viewLabel(view);
  const kindHint = viewKindHint(view);
  const Icon = KIND_ICONS[view.viewKind] ?? List;
  const iconButton = cn(
    'rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
    compact ? 'p-1' : 'p-2',
  );

  const save = async () => {
    setEditing(false);
    await onRename(draft);
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative flex flex-wrap items-center gap-2 rounded-md px-1.5 hover:bg-[var(--color-muted)]',
        compact ? 'py-1' : 'py-2',
        isDragging && 'z-10 bg-[var(--color-muted)] opacity-80 shadow-sm',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={!reorderable}
        aria-label={`Reorder ${label}`}
        title={reorderable ? 'Drag to reorder' : undefined}
        className={cn(
          iconButton,
          'touch-none select-none',
          reorderable && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />

      {editing ? (
        <>
          <input
            aria-label="View name"
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              } else if (e.key === 'Escape') {
                e.preventDefault(); // cancel the rename, not the dialog
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
          />
          <button
            type="button"
            aria-label="Save view name"
            onClick={() => void save()}
            className={cn(iconButton, 'text-[var(--color-primary)]')}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </>
      ) : confirming ? (
        <>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-muted-foreground)]">
            Delete “{label}”?{' '}
            {view.viewKind === 'kanban' ? 'Its buckets go too; tasks are kept.' : 'Tasks are kept.'}
          </span>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md px-2 py-1 text-xs hover:bg-[var(--color-background)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              await onDelete();
              setDeleting(false);
              setConfirming(false);
            }}
            className="rounded-md bg-[var(--color-destructive)] px-2 py-1 text-xs font-medium text-[var(--color-destructive-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            Delete
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm">
            {label}
            {kindHint && (
              <span className="ml-1.5 text-xs text-[var(--color-muted-foreground)]">
                {kindHint}
              </span>
            )}
          </span>
          <button
            type="button"
            disabled={view.placeholder}
            onClick={() => {
              setDraft(view.title || label);
              setEditing(true);
            }}
            aria-label={`Rename ${label}`}
            title={view.placeholder ? BLOCKER_TEXT.placeholder : 'Rename'}
            className={cn(iconButton, 'hover:text-[var(--color-foreground)]')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={view.placeholder}
            aria-expanded={settingsOpen}
            aria-controls={settingsOpen ? panelId : undefined}
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label={`Settings for ${label}`}
            title={view.placeholder ? BLOCKER_TEXT.placeholder : 'Filter and bucket settings'}
            className={cn(iconButton, settingsOpen && 'bg-[var(--color-background)] text-[var(--color-foreground)]')}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={deleteBlocker !== null}
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${label}`}
            title={deleteBlocker ? BLOCKER_TEXT[deleteBlocker] : 'Delete'}
            className={cn(iconButton, 'hover:text-[var(--color-destructive)]')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      {settingsOpen && !editing && !confirming && <ViewSettingsPanel view={view} id={panelId} />}
    </li>
  );
}

function AddViewRow({
  compact,
  onCreate,
}: {
  compact: boolean;
  onCreate: (title: string, kind: ViewKind) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ViewKind>('list');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const reset = () => {
    setOpen(false);
    setTitle('');
    setKind('list');
  };

  const submit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onCreate(newViewTitle(title, kind), kind);
      reset();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'mt-1 flex w-full items-center gap-2 rounded-md px-2 text-left text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]',
          compact ? 'py-1.5' : 'py-2.5',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Add view
      </button>
    );
  }

  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-[var(--color-border)] p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        <input
          aria-label="New view name"
          type="text"
          autoFocus
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault(); // cancel the add, not the dialog
              reset();
            }
          }}
          placeholder={VIEW_KIND_LABELS[kind]}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
        />
        <Select value={kind} onValueChange={(v) => setKind(v as ViewKind)} disabled={busy}>
          <SelectTrigger aria-label="View type" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {VIEW_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add view
        </button>
      </div>
    </form>
  );
}
