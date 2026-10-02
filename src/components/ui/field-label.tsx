import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Visible, persistent label wrapped around a form control. Wrapping gives the
 * control its accessible name without ids, and keeps the label on screen once
 * the placeholder (kept as an example or hint) is gone.
 */
export function FieldLabel({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}
