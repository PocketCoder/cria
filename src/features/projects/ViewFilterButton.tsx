import { useState } from 'react';
import { ListFilter } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { viewFilterParams, type ProjectView } from '@/domain/view';
import { cn } from '@/lib/cn';
import { ViewFilterForm } from './ViewFilterForm';

/**
 * Per-view filter editor (Vikunja project_views.filter). The funnel icon is
 * highlighted while the view has an active filter; saving goes through the
 * normal view outbox push. Disabled for a placeholder view.
 */
export function ViewFilterButton({ view }: { view: ProjectView }) {
  const current = viewFilterParams(view);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter this view"
          // A placeholder view can't be edited until the server's views
          // arrive (updateView refuses it).
          disabled={view.placeholder}
          title={view.placeholder ? 'Available once this project has synced' : undefined}
          className={cn(
            'rounded-md p-1.5 hover:bg-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
            current
              ? 'text-[var(--color-primary)]'
              : 'text-[var(--color-muted-foreground)]',
          )}
        >
          <ListFilter className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <ViewFilterForm view={view} onSaved={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
