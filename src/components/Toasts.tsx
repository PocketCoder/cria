import { createPortal } from 'react-dom';
import { Check, AlertCircle } from 'lucide-react';
import { useToasts } from '@/stores/toasts';
import { useTopModalDialog } from '@/lib/modalStack';
import { cn } from '@/lib/cn';

/** Floating status messages. Inside the open modal dialog when there is one, since the rest of the page is inert then. */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dialog = useTopModalDialog();
  if (toasts.length === 0) return null;

  const stack = (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[60] flex flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'toast-up pointer-events-auto flex max-w-sm items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3.5 py-2 text-xs shadow-lg',
            t.kind === 'error' ? 'text-[var(--color-destructive)]' : 'text-[var(--color-foreground)]',
          )}
        >
          {t.kind === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-success-text)]" />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
  return dialog ? createPortal(stack, dialog) : stack;
}
