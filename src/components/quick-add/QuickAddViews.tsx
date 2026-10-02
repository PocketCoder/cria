import type { MutableRefObject, FormEvent, KeyboardEvent, RefObject } from 'react';
import { ArrowUp, Camera, Mic } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { QuickAddResult } from '@/lib/quickAddParser';
import { TokenInput } from './TokenInput';
import { SetChips } from './SetChips';

type ChipProps = Parameters<typeof SetChips>[0];

interface ViewProps {
  text: string;
  setText: (v: string) => void;
  parsed: QuickAddResult;
  titleRef: RefObject<HTMLInputElement>;
  onTitleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  submitDisabled: boolean;
  chipProps: ChipProps;
}

interface MobileProps extends ViewProps {
  description: string;
  setDescription: (v: string) => void;
  panelRef: RefObject<HTMLDivElement>;
  drag: MutableRefObject<{ startY: number; active: boolean; allowed: boolean }>;
  dragY: number;
  keyboardInset: number;
  onOpenPhotoCapture: () => void;
  /** Present only when AI is available. */
  onOpenRamble?: () => void;
}

/**
 * Capture sheet: a solid card anchored to the bottom (lifted above the
 * keyboard) with a 21px token-highlighted Task-name field, a muted note line,
 * only-set chips + dashed affordance, and a syntax-hint footer with a 46px ink
 * send button.
 */
export function MobileQuickAdd({
  text,
  setText,
  parsed,
  titleRef,
  onTitleKeyDown,
  onSubmit,
  onClose,
  submitDisabled,
  chipProps,
  description,
  setDescription,
  panelRef,
  drag,
  dragY,
  keyboardInset,
  onOpenPhotoCapture,
  onOpenRamble,
}: MobileProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Add task"
      onClick={onClose}
    >
      <div className="sheet-backdrop absolute inset-0" />
      <div
        ref={panelRef}
        className={cn(
          'relative z-10 w-full rounded-t-[22px] bg-[var(--color-card)] pt-2.5 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)] dark:border dark:border-[var(--sheet-border)]',
          dragY === 0 && !drag.current.active && 'animate-[sheet-up_300ms_var(--spring-snappy)]',
        )}
        style={{
          marginBottom: keyboardInset,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current.active ? 'none' : 'transform 240ms var(--spring-snappy)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-1 h-[5px] w-[38px] rounded-full bg-[var(--color-muted-foreground)]/30" />
        <form onSubmit={onSubmit}>
          <div className="px-5 pt-3">
            <TokenInput
              value={text}
              parsed={parsed}
              onChange={setText}
              onKeyDown={onTitleKeyDown}
              inputRef={titleRef}
              placeholder="Task name"
              className="text-[21px] font-medium leading-[1.35] tracking-[-0.015em]"
            />
            <input
              type="text"
              placeholder="Add a note…"
              className="mt-2 w-full bg-transparent text-[15px] text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="mt-4 px-5 pb-4">
            <SetChips {...chipProps} />
          </div>

          {/* Footer — syntax hint (left) + camera & 46px ink send (right). */}
          <div
            className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-3"
            style={{ paddingBottom: keyboardInset ? undefined : 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
          >
            <span className="text-[12.5px] text-[var(--color-muted-foreground)]">
              <code className="font-mono text-[var(--color-primary)]">+project</code>
              <span className="mx-1.5">·</span>
              <code className="font-mono text-[var(--color-primary)]">*label</code>
              <span className="mx-1.5">·</span>
              <code className="font-mono text-[var(--color-primary)]">!2</code>
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {onOpenRamble && (
                <button
                  type="button"
                  aria-label="Ramble"
                  title="Ramble: talk freely, get a list of tasks"
                  onClick={onOpenRamble}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                >
                  <Mic className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                aria-label="Add tasks from a photo"
                title="Add tasks from a photo of a list"
                onClick={onOpenPhotoCapture}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                <Camera className="h-5 w-5" />
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                aria-label="Add task"
                className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[var(--color-inverse)] text-[var(--color-inverse-foreground)] disabled:opacity-40"
              >
                <ArrowUp className="h-6 w-6" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DesktopProps extends ViewProps {
  submitting: boolean;
}

export function DesktopQuickAdd({
  text,
  setText,
  parsed,
  titleRef,
  onTitleKeyDown,
  onSubmit,
  onClose,
  submitDisabled,
  submitting,
  chipProps,
}: DesktopProps) {
  return (
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay-backdrop)] pt-[70px]"
      onClick={onClose}
    >
      <div
        className="w-[560px] rounded-[14px] bg-[var(--color-card)] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.4)] dark:border dark:border-[var(--sheet-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={onSubmit}>
          <div className="px-5 pt-5">
            <TokenInput
              value={text}
              parsed={parsed}
              onChange={setText}
              onKeyDown={onTitleKeyDown}
              inputRef={titleRef}
              placeholder="Buy milk tomorrow *groceries !2 @alice +Personal"
              className="text-[19px] font-semibold tracking-[-0.015em]"
            />
          </div>

          <div className="px-5 py-4">
            <SetChips {...chipProps} />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
            <span className="text-[11.5px] text-[var(--color-muted-foreground)]">
              ⏎ add · ⇧⏎ add &amp; keep open · esc cancel
            </span>
            <button
              type="submit"
              disabled={submitDisabled}
              className="rounded-md bg-[var(--color-inverse)] px-4 py-2 text-[13px] font-semibold text-[var(--color-inverse-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
