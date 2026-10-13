import { Download } from 'lucide-react';
import type { UpdaterState } from '@/stores/updater';

interface UpdateBannerProps {
  state: UpdaterState;
  onInstall: () => void;
  /** Why the last install attempt was held back, if it was. */
  blockedMessage?: string | null;
}

/**
 * Footer-bar pill that surfaces an available update. Renders nothing
 * unless an update is actually available or currently installing —
 * "no update" is the most common state and shouldn't draw the eye.
 */
export function UpdateBanner({ state, onInstall, blockedMessage }: UpdateBannerProps) {
  if (state.kind !== 'available' && state.kind !== 'installing') return null;

  const installing = state.kind === 'installing';
  const version = state.update.version;

  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={installing}
      title={
        blockedMessage ?? state.update.notes ?? 'Click to restart into the new version'
      }
      className="flex items-center gap-1.5 rounded-full bg-[var(--color-primary)] px-2.5 py-1 text-caption font-medium text-[var(--color-primary-foreground)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Download className="h-3 w-3" />
      {installing
        ? `Installing v${version}…`
        : blockedMessage
          ? 'Sync your changes, then retry the update'
          : `Update v${version} ready — restart`}
    </button>
  );
}
