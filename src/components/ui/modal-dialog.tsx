import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { pushModalDialog } from '@/lib/modalStack';

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
 * Dialogs stack: a later `showModal()` sits above earlier ones. Anything else
 * that must stay usable above an open dialog has to render inside it, so the
 * Radix portals (Popover, Select, ContextMenu) and the undo toast target the
 * topmost dialog via `useTopModalDialog()` instead of `document.body`.
 *
 * `showModal()` only exists from Safari / iOS 15.4, and calling it on older
 * WebKit would throw and take the tree down. There the dialog degrades to a
 * plain fixed overlay (`data-modal-fallback`, see globals.css): the `open`
 * attribute is set by hand, Escape is handled on keydown (no native `cancel`),
 * and focus is restored on close. The background is not made inert.
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
  // True when this dialog was opened without `showModal()` (old WebKit).
  const fallback = useRef(false);
  // Children render only once the dialog is open: a closed dialog is
  // display:none, so anything that focuses itself on mount would be a no-op.
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    unmounting.current = false;
    // `open` is undefined on browsers without <dialog>, so test the attribute.
    const isOpen = el.hasAttribute('open');
    fallback.current = typeof el.showModal !== 'function';
    const returnFocus = document.activeElement;
    if (fallback.current) {
      if (!isOpen) {
        // Later dialogs paint above earlier ones whatever their DOM order.
        el.style.zIndex = String(1000 + document.querySelectorAll('[data-modal-fallback]').length);
        el.setAttribute('data-modal-fallback', '');
        el.setAttribute('open', '');
      }
    } else if (!isOpen) {
      el.showModal();
    }
    const unregister = pushModalDialog(el);
    setOpen(true);
    return () => {
      unmounting.current = true;
      unregister();
      if (fallback.current) {
        el.removeAttribute('open');
        el.removeAttribute('data-modal-fallback');
        if (returnFocus instanceof HTMLElement) returnFocus.focus();
      } else if (el.open) {
        el.close();
      }
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
      // No native `cancel` without showModal(): handle Escape here. Local
      // Escape handlers inside have already called preventDefault().
      onKeyDown={(e) => {
        if (!fallback.current || e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}
      // Closed by the browser without a cancel (e.g. a second Escape press).
      // `close` fires asynchronously, so under StrictMode's setup/cleanup/setup
      // the event from the cleanup's `close()` arrives after the dialog has
      // been reopened: ignore it unless the dialog really is closed now.
      onClose={(e) => {
        if (!unmounting.current && !e.currentTarget.open) onClose();
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
