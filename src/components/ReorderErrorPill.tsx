import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Small warning pill shown when a drag‑reorder operation fails.
 * Auto‑dismisses after 4 seconds or when the user clicks the close button.
 */
export function ReorderErrorPill({
  message = 'Reorder failed – priority/date ordering applied',
  onClose,
}: {
  message?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onClose, 4000);
    return () => clearTimeout(id);
  }, [onClose]);

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md',
        'bg-[rgba(255,165,0,0.9)] px-3 py-1 text-sm text-white shadow-md',
      )}
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
      <button
        onClick={onClose}
        className="ml-2 flex-shrink-0 rounded-full p-0.5 hover:bg-white/20"
        aria-label="Dismiss warning"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
