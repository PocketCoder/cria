import { useFocusOnMount } from '@/lib/useFocusOnMount';
import { useState, type ComponentType, type ReactNode } from 'react';
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Share2,
  Palette,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { updateProject } from '@/db/projects';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { Project } from '@/domain/project';
import type { Label } from '@/domain/label';
import { PROJECT_COLORS } from './sidebarLogic';

/** Primary tint + primary text so the active row stays distinct from the neutral muted hover fill. */
const SELECTED_ROW =
  'bg-[var(--color-primary)]/10 font-medium text-[color:var(--color-primary)] hover:bg-[var(--color-primary)]/15 hover:text-[color:var(--color-primary)]';

/* ────────────────────────── shared nav item ─────────────────────────── */

export function NavItem({
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
      aria-current={isSelected ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13.5px]',
        'hover:bg-[var(--color-muted)]',
        isSelected && SELECTED_ROW,
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

/* ────────────────────────── shared row pieces ─────────────────────────── */

function RenameInput({
  label,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const focusOnMount = useFocusOnMount<HTMLInputElement>();
  return (
    <li>
      <input
        aria-label={label}
        type="text"
        ref={focusOnMount}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      />
    </li>
  );
}

function DeleteConfirm({
  title,
  note,
  onCancel,
  onConfirm,
}: {
  title: string;
  note: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-1.5 p-1.5 text-xs">
      <p>Delete "{title}"?</p>
      <p className="text-footnote text-[var(--color-muted-foreground)]">{note}</p>
      <div className="flex justify-end gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 hover:bg-[var(--color-muted)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-[var(--color-destructive)] px-2 py-1 font-medium text-[var(--color-destructive-foreground)] hover:opacity-90"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-muted)]';
const MENU_ITEM_DANGER =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10';

function RenameMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <li>
      <button type="button" className={MENU_ITEM} onClick={onClick}>
        <Pencil className="h-3.5 w-3.5" />
        Rename
      </button>
    </li>
  );
}

function DeleteMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <li>
      <button type="button" className={MENU_ITEM_DANGER} onClick={onClick}>
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    </li>
  );
}

/** Hover "…" button + popover shell shared by project and label rows. */
function RowPopover({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-muted-foreground)]',
            'opacity-0 transition-opacity hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)] group-hover:opacity-100',
            open && 'opacity-100',
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" sideOffset={4} className="w-44 p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function useRowMenuState() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return { menuOpen, setMenuOpen, confirmDelete, setConfirmDelete };
}

/* ────────────────────────── project row ─────────────────────────── */

interface ProjectRowProps {
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
}

export function ProjectRow({
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
}: ProjectRowProps) {
  const menu = useRowMenuState();
  const [colorOpen, setColorOpen] = useState(false);

  if (isEditing) {
    return (
      <RenameInput
        label="Project name"
        value={editingTitle}
        onChange={onChangeRename}
        onSave={onSaveRename}
        onCancel={onCancelRename}
      />
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
            <ExpandToggle
              hasChildren={hasChildren}
              expanded={expanded}
              onToggle={onToggleExpand}
            />
            <ProjectSelectButton
              project={project}
              isSelected={isSelected}
              taskCount={taskCount}
              onSelect={onSelect}
            />
          </div>

          <RowPopover title={project.title} open={menu.menuOpen} onOpenChange={menu.setMenuOpen}>
            {menu.confirmDelete ? (
              <DeleteConfirm
                title={project.title}
                note="Tasks inside the project are removed too."
                onCancel={() => menu.setConfirmDelete(false)}
                onConfirm={async () => {
                  await onDelete();
                  menu.setMenuOpen(false);
                  menu.setConfirmDelete(false);
                }}
              />
            ) : (
              <ul className="text-xs">
                <RenameMenuItem
                  onClick={() => {
                    onStartRename();
                    menu.setMenuOpen(false);
                  }}
                />
                <li>
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => setColorOpen(!colorOpen)}
                  >
                    <Palette className="h-3.5 w-3.5" />
                    Color
                  </button>
                  {colorOpen && (
                    <ColorPicker
                      project={project}
                      onDone={() => {
                        menu.setMenuOpen(false);
                        setColorOpen(false);
                      }}
                    />
                  )}
                </li>
                <DeleteMenuItem onClick={() => menu.setConfirmDelete(true)} />
              </ul>
            )}
          </RowPopover>
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

/** Own button so it never nests inside the row's select button. Sits in the nav's left gutter so dots align with the Labels rows and section headers. */
function ExpandToggle({
  hasChildren,
  expanded,
  onToggle,
}: {
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!hasChildren) return null;
  return (
    <button
      type="button"
      aria-label={expanded ? 'Collapse sub-projects' : 'Expand sub-projects'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="absolute -left-3 top-1/2 flex h-5 w-4 -translate-y-1/2 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
    >
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function ProjectSelectButton({
  project,
  isSelected,
  taskCount,
  onSelect,
}: {
  project: Project;
  isSelected: boolean;
  taskCount: number;
  onSelect: () => void;
}) {
  const badgeTone = isSelected ? 'opacity-70' : 'text-[var(--color-muted-foreground)]';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-[6px] pr-8 text-left text-[13.5px]',
        'hover:bg-[var(--color-muted)] hover:text-[color:var(--color-foreground)]',
        isSelected && SELECTED_ROW,
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
        <span className={cn('ml-auto text-footnote uppercase', badgeTone)}>archived</span>
      ) : taskCount > 0 ? (
        <span className={cn('ml-auto text-footnote', badgeTone)}>{taskCount}</span>
      ) : null}
    </button>
  );
}

function ColorPicker({ project, onDone }: { project: Project; onDone: () => void }) {
  return (
    <div className="flex flex-wrap gap-1 px-2 py-1.5">
      {PROJECT_COLORS.map((c) => (
        <button
          aria-label={`Set colour ${c}`}
          key={c}
          onClick={async () => {
            await updateProject(project.localId, {
              hexColor: c === project.hexColor ? null : c,
            });
            onDone();
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
          onDone();
        }}
        className="h-5 w-5 cursor-pointer rounded-full border-0 overflow-hidden"
        title="Custom color"
      />
      <button
        onClick={async () => {
          await updateProject(project.localId, { hexColor: null });
          onDone();
        }}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] text-footnote text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/10"
        title="Remove color"
      >
        ×
      </button>
    </div>
  );
}

/* ────────────────────────── label row ─────────────────────────── */

export function LabelRow({
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
  const menu = useRowMenuState();

  if (isEditing) {
    return (
      <RenameInput
        label="Label name"
        value={editingTitle}
        onChange={onChangeRename}
        onSave={onSaveRename}
        onCancel={onCancelRename}
      />
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li className="group relative">
          <button
            type="button"
            onClick={onSelect}
            aria-current={isSelected ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-[6px] pr-8 text-left text-[13.5px]',
              'hover:bg-[var(--color-muted)]',
              isSelected && SELECTED_ROW,
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

          <RowPopover title={label.title} open={menu.menuOpen} onOpenChange={menu.setMenuOpen}>
            {menu.confirmDelete ? (
              <DeleteConfirm
                title={label.title}
                note="Removed from all tasks."
                onCancel={() => menu.setConfirmDelete(false)}
                onConfirm={async () => {
                  await onDelete();
                  menu.setMenuOpen(false);
                  menu.setConfirmDelete(false);
                }}
              />
            ) : (
              <ul className="text-xs">
                <RenameMenuItem
                  onClick={() => {
                    onStartRename();
                    menu.setMenuOpen(false);
                  }}
                />
                <DeleteMenuItem onClick={() => menu.setConfirmDelete(true)} />
              </ul>
            )}
          </RowPopover>
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
