import { AlertTriangle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Amber inline-warning strip — the small `AlertTriangle` + message
 * pattern used inside task-detail sections for upload errors,
 * permission hints, and other in-flow warnings.
 *
 * Pass `onDismiss` to render the close button. Without it the strip is
 * persistent (e.g. the reminders "notifications off" hint).
 */
export function InlineWarning({
  children,
  onDismiss,
  className,
}: {
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2 py-1.5 text-xs',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
      <div className="flex-1 leading-snug text-[var(--color-foreground)]">
        {children}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
