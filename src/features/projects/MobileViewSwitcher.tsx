import { useState } from 'react';
import { LayoutGrid, Check, Info, Settings2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import type { ProjectView } from '@/domain/view';

const VIEW_LABELS: Record<string, string> = {
  list: 'List',
  kanban: 'Board',
  table: 'Table',
  gantt: 'Gantt',
};

/**
 * Compact, icon-triggered view switcher for the mobile app header. The desktop
 * segmented ViewSwitcher is too wide to sit inline next to the search/add
 * actions, so on phones we collapse it to a single icon that opens a popover
 * list, which ends with "Manage views" when `onManage` is given. Renders
 * nothing when there's only one view and nothing to manage.
 */
export function MobileViewSwitcher({
  views,
  activeViewLocalId,
  onSelect,
  onManage,
  onInfo,
}: {
  views: ProjectView[];
  activeViewLocalId: string | undefined;
  onSelect: (viewLocalId: string) => void;
  onManage?: (() => void) | undefined;
  /** Adds a "Project info" entry. */
  onInfo?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (views.length <= 1 && !onManage && !onInfo) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch view"
          className="rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <LayoutGrid className="h-5 w-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {views.map((v) => {
          const active = v.localId === activeViewLocalId;
          return (
            <button
              key={v.localId}
              type="button"
              onClick={() => {
                onSelect(v.localId);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm',
                active
                  ? 'text-[var(--color-primary)]'
                  : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
              )}
            >
              <span>{v.title || VIEW_LABELS[v.viewKind] || v.viewKind}</span>
              {active && <Check className="h-4 w-4" />}
            </button>
          );
        })}
        {(onManage || onInfo) && (
          <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />
        )}
        {onInfo && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onInfo();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
          >
            <Info className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            Project info
          </button>
        )}
        {onManage && (
          <>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
            >
              <Settings2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              Manage views
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
