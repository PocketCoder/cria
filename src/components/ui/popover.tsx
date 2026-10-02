import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * Floating panel container. Themed against our `--color-card` /
 * `--color-border` tokens so it sits cleanly on top of whichever pane
 * it anchors against (TaskActions sidebar, future Cmd+K palette, etc.).
 */
export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 rounded-md border border-[var(--color-border)] bg-[var(--glass-bg)] p-2 text-[var(--color-card-foreground)] shadow-md outline-none backdrop-blur-[var(--glass-blur)]',
        'pop-in origin-[var(--radix-popover-content-transform-origin)]',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

/** Trigger chip for the create-flow pickers (quick-add). Mirrors the `chip`
    utility plus a border, spelled as Tailwind classes so `cn` can merge
    overrides (e.g. SelectTrigger's base padding). */
export const pickerChipClass =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13.5px] font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]';

/** Option row inside a picker popover; matches the task-detail chip menus. */
export const pickerRowClass =
  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)]';

/** Optional controlled open state, so a parent can keep only one picker open. */
export interface PickerOpenProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
