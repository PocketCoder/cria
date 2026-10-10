import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  currentSessionId,
  describeDevice,
  listSessions,
  revokeSession,
  type Session,
} from '@/api/sessions';
import { getAuthSnapshot, useAuth } from '@/auth/store';
import { useDateFormatter } from '@/lib/dateFormat';
import { useIsMobile } from '@/lib/useIsMobile';

/** Devices signed in to this account; revoke any of them. Hidden when the server has no sessions route. */
export function SessionsSection({ disabled }: { disabled?: boolean }) {
  const qc = useQueryClient();
  const { formatDateTime } = useDateFormatter();
  const currentId = currentSessionId(getAuthSnapshot().token);
  const { data: sessions, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
    enabled: !disabled,
    retry: false,
  });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const isMobile = useIsMobile();
  const action = isMobile ? 'h-11 px-4 text-sm' : '';

  if (sessions === null) return null;

  // This device first, then most recently active (the API already sorts those).
  const ordered = [...(sessions ?? [])].sort(
    (a, b) => Number(b.id === currentId) - Number(a.id === currentId),
  );

  const revoke = async (s: Session) => {
    setBusyId(s.id);
    setFailure('');
    try {
      await revokeSession(s.id);
      setConfirmId(null);
      // Revoking this device's own session ends it: sign out here too.
      if (s.id === currentId) {
        void useAuth.getState().signOut();
        return;
      }
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Sessions</h3>
      <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
        {!sessions && !error && (
          <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
        )}
        {error && (
          <p className="text-sm text-[var(--color-destructive)]">
            Couldn’t load sessions: {(error as Error).message}
          </p>
        )}
        {sessions && sessions.length === 0 && (
          <p className="text-sm text-[var(--color-muted-foreground)]">No active sessions.</p>
        )}
        {ordered.map((s) => {
          const isCurrent = s.id === currentId;
          const device = describeDevice(s.deviceInfo);
          return (
            <div key={s.id} className="space-y-2 rounded bg-[var(--color-muted)] px-2 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm">
                    {device}
                    {isCurrent && (
                      <span className="ml-2 rounded bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-xs text-[var(--color-primary)]">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                    {[s.ipAddress, s.lastActive && `active ${formatDateTime(s.lastActive)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {confirmId !== s.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={action}
                    disabled={disabled}
                    onClick={() => setConfirmId(s.id)}
                  >
                    {isCurrent ? 'Sign out…' : 'Revoke…'}
                  </Button>
                )}
              </div>
              {confirmId === s.id && (
                <div role="group" aria-label={`Confirm for ${device}`} className="space-y-2">
                  <p className="text-xs">
                    {isCurrent
                      ? 'Sign out of this device? You’ll need to sign in again.'
                      : `Revoke access for ${device}? It will be signed out.`}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className={action}
                      onClick={() => setConfirmId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className={action}
                      disabled={disabled || busyId === s.id}
                      onClick={() => void revoke(s)}
                    >
                      {isCurrent ? 'Sign out' : 'Revoke access'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {failure && <p className="text-xs text-[var(--color-destructive)]">{failure}</p>}
      </div>
    </section>
  );
}
