import { useState, useEffect } from 'react';
import {
  getExportStatus,
  requestExport,
  downloadExport,
  requestDeletion,
  cancelDeletion,
  type ExportStatus,
} from '@/api/account';
import { saveBlob } from '@/lib/download';
import { useCurrentUser } from '@/queries/user';
import { Button } from '@/components/ui/button';

interface Props {
  disabled?: boolean;
}

export function DataTab({ disabled }: Props) {
  const { data: user } = useCurrentUser();
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');

  const [delPassword, setDelPassword] = useState('');
  const [showDelConfirm, setShowDelConfirm] = useState(false);
  const [delError, setDelError] = useState('');

  const raw = user?.raw as Record<string, unknown> | undefined;
  const deletionScheduledAt = raw?.deletion_scheduled_at as string | undefined;
  const hasDeletionScheduled = deletionScheduledAt && deletionScheduledAt !== '0001-01-01T00:00:00Z';

  useEffect(() => {
    getExportStatus()
      .then(setExportStatus)
      .catch(() => setExportStatus(null));
  }, []);

  const handleRequestExport = async () => {
    setExportLoading(true);
    setExportError('');
    try {
      await requestExport('');
      const status = await getExportStatus();
      setExportStatus(status);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExportLoading(false);
    }
  };

  const handleDownloadExport = async () => {
    setExportError('');
    try {
      const blob = await downloadExport('');
      saveBlob(blob, 'vikunja-export.zip');
    } catch (e) {
      setExportError((e as Error).message);
    }
  };

  const handleRequestDeletion = async () => {
    setDelError('');
    try {
      await requestDeletion(delPassword);
      setShowDelConfirm(false);
      setDelPassword('');
    } catch (e) {
      setDelError((e as Error).message);
    }
  };

  const handleCancelDeletion = async () => {
    setDelError('');
    try {
      await cancelDeletion('');
    } catch (e) {
      setDelError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Data Export</h3>
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Export all your tasks, projects, and settings as a ZIP file.
          </p>
          {exportStatus && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Last export: {exportStatus.created ? new Date(exportStatus.created).toLocaleDateString() : 'N/A'}
              {exportStatus.size ? ` (${(exportStatus.size / 1024).toFixed(0)} KB)` : ''}
            </p>
          )}
          {exportError && <p className="text-xs text-red-500">{exportError}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void handleRequestExport()} disabled={disabled || exportLoading}>
              {exportLoading ? 'Requesting…' : 'Request Export'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleDownloadExport()} disabled={disabled}>
              Download
            </Button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Delete Account</h3>
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
          {hasDeletionScheduled ? (
            <div>
              <p className="mb-2 text-sm text-amber-500">
                Deletion scheduled for {new Date(deletionScheduledAt).toLocaleString()}.
                Check your email to confirm.
              </p>
              <Button variant="outline" size="sm" onClick={() => void handleCancelDeletion()} disabled={disabled}>
                Cancel Deletion
              </Button>
            </div>
          ) : !showDelConfirm ? (
            <div>
              <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">
                Permanently delete your account and all data. This action sends a confirmation email.
              </p>
              <Button variant="destructive" size="sm" onClick={() => setShowDelConfirm(true)} disabled={disabled}>
                Request Account Deletion
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-red-500">Enter your password to confirm:</p>
              <input
                type="password"
                value={delPassword}
                onChange={(e) => setDelPassword(e.target.value)}
                placeholder="Current password"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
              />
              {delError && <p className="text-xs text-red-500">{delError}</p>}
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={() => void handleRequestDeletion()} disabled={disabled || !delPassword}>
                  Confirm Deletion
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setShowDelConfirm(false); setDelPassword(''); setDelError(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
