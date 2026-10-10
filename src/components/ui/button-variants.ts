import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90',
        outline:
          'border border-[var(--color-border)] bg-transparent hover:bg-[var(--color-muted)]',
        ghost: 'border border-transparent hover:bg-[var(--color-muted)]',
        glass:
          'bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)] hover:opacity-90',
        destructive:
          'bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
