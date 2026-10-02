import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Text input with a visible, persistent label wrapped around it. Wrapping names
 * the control without ids and keeps the label on screen once the placeholder
 * (kept as an example or hint) is gone.
 */
export function LabeledInput({
  label,
  className,
  inputClassName,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Classes for the wrapping label (layout). */
  className?: string;
  /** Classes for the input itself. */
  inputClassName?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">{label}</span>
      <input {...inputProps} className={inputClassName} />
    </label>
  );
}
