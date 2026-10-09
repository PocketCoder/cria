import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** `sm` is 32px tall; the default is 40px. (`size` is the native attribute.) */
  inputSize?: 'default' | 'sm';
  /** Leading icon, muted, 12px in from the left. */
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', inputSize = 'default', icon, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex w-full rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm placeholder:text-[var(--color-muted-foreground)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ring-offset-background focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          inputSize === 'sm' ? 'h-8' : 'h-10',
          icon != null && 'pl-9',
          className,
        )}
        {...props}
      />
    );
    if (icon == null) return field;
    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-[var(--color-muted-foreground)] [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </span>
        {field}
      </div>
    );
  },
);
Input.displayName = 'Input';
