import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';

/**
 * A modal that is a bottom sheet on iPhone-width layouts (grabber, safe-area
 * padding, 44pt close target, like TaskActionSheet) and a centred dialog on
 * desktop. `title` is the visible heading; `label` defaults to it.
 */
export function AdaptiveDialog({
  title,
  label,
  onClose,
  children,
  maxWidth = 'max-w-lg',
}: {
  title: ReactNode;
  label: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  const isMobile = useIsMobile();
  const header = (
    <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold [&>*]:min-w-0">
        <span className="truncate">{title}</span>
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cn(
          'flex shrink-0 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
          isMobile ? 'h-11 w-11' : 'h-7 w-7',
        )}
      >
        <X className="h-4 w-4" />
      </button>
    </header>
  );

  if (isMobile) {
    return (
      <ModalDialog label={label} onClose={onClose}>
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <BackdropDismiss onDismiss={onClose} className="sheet-backdrop" />
          <div className="safe-bottom relative z-10 flex max-h-[85vh] flex-col rounded-t-2xl bg-[var(--color-background)] pt-2 shadow-[var(--shadow-sheet)] dark:border-t dark:border-[var(--sheet-border)] animate-[sheet-up_300ms_var(--spring-snappy)]">
            <div className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
            {header}
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>
        </div>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog label={label} onClose={onClose}>
      <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[var(--dialog-backdrop)] p-4">
        <BackdropDismiss onDismiss={onClose} />
        <div className={cn('relative dialog-panel flex max-h-[85vh] w-11/12 flex-col overflow-hidden', maxWidth)}>
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </ModalDialog>
  );
}
