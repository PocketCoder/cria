import { cn } from '@/lib/cn';

/**
 * Click-away layer for a modal or sheet. Render it as the first child of the
 * backdrop container and give the panel `relative` so it paints above this
 * layer: clicks on the panel then never reach it, so the panel needs no
 * `stopPropagation` and the backdrop needs no click handler of its own.
 *
 * The `data-backdrop-dismiss` marker lets `.dialog-backdrop` animate the panel
 * rather than this layer (see globals.css).
 *
 * Pointer-only by design: it is out of the tab order and hidden from assistive
 * tech because every modal has a real close control and handles Escape.
 */
export function BackdropDismiss({
  onDismiss,
  className,
}: {
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      data-backdrop-dismiss=""
      onClick={onDismiss}
      className={cn('absolute inset-0 h-full w-full cursor-default', className)}
    />
  );
}
