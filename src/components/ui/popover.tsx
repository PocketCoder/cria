import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';
import { useTopModalDialog } from '@/lib/modalStack';
import { useIsMobile } from '@/lib/useIsMobile';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * Floating panel container. Themed against our `--color-card` /
 * `--color-border` tokens so it sits cleanly on top of whichever pane
 * it anchors against (TaskActions sidebar, future Cmd+K palette, etc.).
 * Portals into the open modal dialog, if any: `document.body` is inert and
 * painted underneath while one is open.
 */
export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => {
  // iPhone-width: the popover becomes a bottom sheet (see `.popover-sheet` in
  // globals.css, which pins Radix's positioning wrapper to the bottom edge)
  // with a scrim, instead of a small desktop popover floating over the UI.
  const isMobile = useIsMobile();
  return (
    <PopoverPrimitive.Portal container={useTopModalDialog() ?? undefined}>
      <div className="contents">
      {isMobile ? <div aria-hidden="true" className="sheet-backdrop fixed inset-0 z-50" /> : null}
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-md border border-[var(--color-border)] bg-[var(--glass-bg)] p-2 text-[var(--color-card-foreground)] shadow-md outline-none backdrop-blur-[var(--glass-blur)]',
          isMobile ? 'popover-sheet' : 'pop-in origin-[var(--radix-popover-content-transform-origin)]',
          className,
        )}
        {...props}
      />
      </div>
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

/** Trigger pill for the create-flow pickers (quick-add): full radius, 6px 12px,
    12px text, muted wash on hover. Spelled as Tailwind classes so `cn` can merge
    overrides (e.g. SelectTrigger's base padding). */
export const pickerChipClass =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-xs [@media(pointer:coarse)]:min-h-11 text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]';

/** Option row inside a picker popover; matches the task-detail chip menus. */
export const pickerRowClass =
  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] [@media(pointer:coarse)]:min-h-11 transition-colors hover:bg-[var(--color-muted)]';

/** Optional controlled open state, so a parent can keep only one picker open. */
export interface PickerOpenProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
