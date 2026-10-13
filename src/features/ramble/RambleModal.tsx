import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { useEscapeKey } from '@/components/quick-add/useSheetBehaviour';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import { RambleHeader, RambleReview } from './RambleParts';
import { useRamble } from './useRamble';

/**
 * Ramble: talk (or type) freely, get a reviewed batch of tasks.
 *
 * The mic button listens live (Apple Speech framework, src/tauri/speech.ts): finished
 * phrases are organised by the on-device model and appear as editable rows,
 * each addable on its own, with Add all at the bottom. Typing then Organise
 * still works. The model rewrites speech as quick-add lines ("Call dentist next tue !3 +Health"), so the existing
 * quick-add parser resolves dates, projects and labels, and the user edits
 * those lines directly in review. The model call survives app switching
 * (iOS Live Activity / desktop notification, see src/tauri/ai.ts).
 */
export function RambleModal({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const r = useRamble(onClose);
  useEscapeKey(r.close);

  const body = (
    <>
      <RambleHeader busy={r.phase === 'saving'} onClose={r.close} />
      <RambleReview
        phase={r.phase}
        drafts={r.drafts}
        chosenCount={r.chosen.length}
        projects={r.projects}
        projectId={r.projectId}
        setProjectId={r.setProjectId}
        error={r.error}
        onUpdate={r.updateDraft}
        onDelete={r.deleteDraft}
        onAddAll={r.addAll}
        adding={r.addQueued}
        suggestionCtx={r.suggestionCtx}
        onAccept={r.acceptOne}
        onAcceptAll={r.acceptAll}
        listening={r.listening}
        interim={r.interim}
        organising={r.organising}
        busyIds={r.busyIds}
        onMic={() => void r.toggleMic()}
        onAddOne={(id) => void r.addOne(id)}
      />
    </>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ramble"
      className={cn(
        'fixed inset-0 z-50',
        isMobile ? '' : 'flex items-start justify-center bg-[var(--dialog-backdrop)] pt-24',
      )}
    >
      {isMobile ? (
        <>
          <BackdropDismiss onDismiss={r.close} className="sheet-backdrop" />
          <div className="absolute bottom-0 left-0 right-0 z-10 animate-[sheet-up_350ms_var(--spring-snappy)] rounded-t-2xl bg-[var(--sheet-bg)] px-4 pb-8 pt-2 shadow-[var(--shadow-sheet)] dark:border-t dark:border-[var(--sheet-border)]">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-muted-foreground)]/30" />
            {body}
          </div>
        </>
      ) : (
        <>
          <BackdropDismiss onDismiss={r.close} />
          <div className="relative dialog-panel w-11/12 max-w-lg p-4">
            {body}
          </div>
        </>
      )}
    </div>
  );
}
