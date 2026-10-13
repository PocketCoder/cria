import type { MutableRefObject, FormEvent, KeyboardEvent, RefObject } from 'react';
import { ArrowUp, Camera, Mic } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import type { QuickAddResult } from '@/lib/quickAddParser';
import { QUICK_ADD_PREFIXES, type QuickAddMagicMode } from '@/lib/quickAddPrefixes';
import { TokenInput } from './TokenInput';
import { SetChips } from './SetChips';

type ChipProps = Parameters<typeof SetChips>[0];

/** Desktop placeholder: a worked example in the active mode's syntax. */
function examplePlaceholder(mode: QuickAddMagicMode): string {
  const p = QUICK_ADD_PREFIXES[mode];
  if (!p) return 'Task name';
  return `Buy milk tomorrow ${p.label}groceries ${p.priority}2 ${p.assignee}alice ${p.project}Personal`;
}

interface ViewProps {
  text: string;
  setText: (v: string) => void;
  parsed: QuickAddResult;
  magicMode: QuickAddMagicMode;
  titleRef: RefObject<HTMLInputElement>;
  onTitleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  submitDisabled: boolean;
  /** Why submit is disabled (temporary diagnostic, shown on mobile). */
  disabledReason?: string;
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
 * only-set chips + a dashed chip whose placeholder is the quick-add syntax, and a footer with a 46px ink
 * send button.
 */
export function MobileQuickAdd({
  text,
  setText,
  parsed,
  magicMode,
  titleRef,
  onTitleKeyDown,
  onSubmit,
  onClose,
  submitDisabled,
  disabledReason,
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
  const prefixes = QUICK_ADD_PREFIXES[magicMode];
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <BackdropDismiss onDismiss={onClose} className="sheet-backdrop" />
      <div
        ref={panelRef}
        className={cn(
          'relative z-10 w-full rounded-t-2xl bg-[var(--sheet-bg)] pt-2 shadow-[var(--shadow-sheet)] dark:border-t dark:border-[var(--sheet-border)]',
          dragY === 0 && !drag.current.active && 'animate-[sheet-up_300ms_var(--spring-snappy)]',
        )}
        style={{
          marginBottom: keyboardInset,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current.active ? 'none' : 'transform 240ms var(--spring-snappy)',
        }}
      >
        <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-[var(--color-muted-foreground)]/30" />
        <form onSubmit={onSubmit}>
          <div className="px-5 pt-3">
            <TokenInput
              value={text}
              parsed={parsed}
              onChange={setText}
              onKeyDown={onTitleKeyDown}
              inputRef={titleRef}
              placeholder="Task name"
              className="text-title font-semibold leading-[1.35] tracking-tight"
            />
            <input
              aria-label="Note"
              type="text"
              placeholder="Add a note…"
              className="mt-2 w-full bg-transparent text-[15px] text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="mt-4 px-5 pb-4">
            <SetChips
              {...chipProps}
              placeholder={
                prefixes ? (
                  <span className="font-mono text-[var(--color-primary)]">
                    {prefixes.project}project<span className="mx-1.5 text-[var(--color-muted-foreground)]">·</span>
                    {prefixes.label}label<span className="mx-1.5 text-[var(--color-muted-foreground)]">·</span>
                    {prefixes.priority}2
                  </span>
                ) : undefined
              }
            />
          </div>

          {/* Footer — camera & 46px ink send (right). */}
          <div
            className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-3"
            style={{ paddingBottom: keyboardInset ? undefined : 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
          >
            <span />
            {submitDisabled && disabledReason ? (
              <span className="text-[11px] text-[var(--color-destructive)]">{disabledReason}</span>
            ) : null}
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
  magicMode,
  titleRef,
  onTitleKeyDown,
  onSubmit,
  onClose,
  submitDisabled,
  submitting,
  chipProps,
}: DesktopProps) {
  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-start justify-center bg-[var(--dialog-backdrop)] pt-[70px]">
      <BackdropDismiss onDismiss={onClose} />
      <div className="relative dialog-panel w-[560px]">
        <form onSubmit={onSubmit}>
          <div className="px-5 pt-5">
            <TokenInput
              value={text}
              parsed={parsed}
              onChange={setText}
              onKeyDown={onTitleKeyDown}
              inputRef={titleRef}
              placeholder={examplePlaceholder(magicMode)}
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
