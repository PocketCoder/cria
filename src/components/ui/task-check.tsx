import { useState, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';

const SPARKS = [0, 60, 120, 180, 240, 300];

/**
 * Round task checkbox with the completion burst (pop, tick draw, ring and
 * sparks). Styling lives in `.task-check*` in globals.css. The burst only
 * plays on a false→true change, never on mount: `burst` keys the animated
 * nodes so each completion replays them.
 */
export function TaskCheck({
  checked,
  onToggle,
  className,
}: {
  checked: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const [prev, setPrev] = useState(checked);
  const [burst, setBurst] = useState(0);
  if (prev !== checked) {
    setPrev(checked);
    if (checked) setBurst((b) => b + 1);
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? 'Done' : 'Not done'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn('task-check', className)}
    >
      {burst > 0 ? (
        <>
          <span key={`r${burst}`} aria-hidden="true" className="task-check-ring" />
          {SPARKS.map((a, i) => (
            <span
              key={`s${burst}-${a}`}
              aria-hidden="true"
              className="task-check-spark"
              style={
                {
                  '--a': `${a}deg`,
                  background: i % 2 ? 'var(--prio-high)' : 'var(--color-primary)',
                } as CSSProperties
              }
            />
          ))}
        </>
      ) : null}
      <span key={`c${burst}`} className="task-check-circle" data-burst={burst > 0 || undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    </button>
  );
}
