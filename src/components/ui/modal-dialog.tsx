import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Native modal `<dialog>` shell. `showModal()` gives the browser's own focus
 * trap, inert background, Escape handling and focus restoration; the dialog
 * itself is a transparent full-viewport frame so callers keep rendering their
 * own backdrop, panel and animations inside it.
 *
 * Mounting opens it, unmounting closes it (which returns focus to whatever had
 * it before). Escape asks the parent to close via `onClose`; handlers inside
 * that use Escape for something local (cancel a rename, dismiss suggestions)
 * must `preventDefault()` it so the dialog is not dismissed too.
 *
 * Do not use for content that opens portalled pickers (Radix Select, Popover,
 * ContextMenu): they render in `document.body`, outside the dialog, so they
 * would be inert and painted underneath the top layer.
 */
export function ModalDialog({
  label,
  onClose,
  className,
  children,
}: {
  /** Accessible name of the dialog. */
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const unmounting = useRef(false);
  // Children render only once the dialog is open: a closed dialog is
  // display:none, so anything that focuses itself on mount would be a no-op.
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    unmounting.current = false;
    if (!el.open) el.showModal();
    setOpen(true);
    return () => {
      unmounting.current = true;
      if (el.open) el.close();
    };
  }, []);

  // Initial focus like a native dialog: unless content already took focus,
  // go to the first control that is in the tab order and not aria-hidden (so
  // never the click-away layer).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const active = document.activeElement;
    if (active && active !== el && el.contains(active)) return;
    firstTabbable(el)?.focus();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={cn(
        'fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-visible border-0 bg-transparent p-0 text-inherit backdrop:bg-transparent',
        className,
      )}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Closed by the browser without a cancel (e.g. a second Escape press).
      onClose={() => {
        if (!unmounting.current) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}

const TABBABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function firstTabbable(root: HTMLElement): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].find(
    (el) => !el.closest('[aria-hidden="true"]'),
  );
}
