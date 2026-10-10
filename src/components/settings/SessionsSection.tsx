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

  if (sessions === null) return null;

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
        {sessions?.length === 0 && (
          <p className="text-sm text-[var(--color-muted-foreground)]">No active sessions.</p>
        )}
        {sessions?.map((s) => {
          const isCurrent = s.id === currentId;
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded bg-[var(--color-muted)] px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {describeDevice(s.deviceInfo)}
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
              {confirmId === s.id ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={disabled || busyId === s.id}
                    onClick={() => void revoke(s)}
                  >
                    {isCurrent ? 'Sign out' : 'Revoke'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setConfirmId(s.id)}
                >
                  {isCurrent ? 'Sign out' : 'Revoke'}
                </Button>
              )}
            </div>
          );
        })}
        {failure && <p className="text-xs text-[var(--color-destructive)]">{failure}</p>}
      </div>
    </section>
  );
}
