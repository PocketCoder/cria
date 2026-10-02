import { useRef } from 'react';
import { cn } from '@/lib/cn';
import type { QuickAddResult } from '@/lib/quickAddParser';

/**
 * The Task-name field with parsed quick-add tokens highlighted inline.
 * A transparent-text input sits on top of an aria-hidden mirror that paints
 * the tokens (`--color-primary` on a light blue, 5px radius); the two share
 * the wrapper's font metrics so they stay pixel-aligned. Scroll syncs so a
 * long title doesn't desync the mirror.
 */
export function TokenInput({
  value,
  parsed,
  onChange,
  onKeyDown,
  inputRef,
  placeholder,
  className,
}: {
  value: string;
  parsed: QuickAddResult;
  onChange: (v: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  placeholder?: string;
  className?: string;
}) {
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const syncScroll = (el: HTMLInputElement | null) => {
    if (mirrorRef.current && el) {
      mirrorRef.current.scrollLeft = el.scrollLeft;
    }
  };
  return (
    <div className={cn('relative w-full', className)}>
      <span
        ref={mirrorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-nowrap"
      >
        {parsed.tokens.map((t, i) =>
          t.kind === 'text' ? (
            <span key={i} className="text-[var(--color-foreground)]">
              {t.text}
            </span>
          ) : (
            <span
              key={i}
              className="rounded-[5px] bg-[var(--color-primary)]/12 px-0.5 text-[var(--color-primary)]"
            >
              {t.text}
            </span>
          ),
        )}
      </span>
      <input
        ref={(el) => {
          syncScroll(el);
          if (inputRef) {
            if (typeof inputRef === 'function') inputRef(el);
            else (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
          }
        }}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => syncScroll(e.currentTarget)}
        placeholder={placeholder}
        className="relative w-full bg-transparent text-transparent [-webkit-text-fill-color:transparent] caret-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
      />
    </div>
  );
}
