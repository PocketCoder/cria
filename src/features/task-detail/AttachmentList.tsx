import { useState } from 'react';
import { Paperclip, Download, Loader2 } from 'lucide-react';
import { getAuthSnapshot } from '@/auth/store';
import { useTaskAttachments } from '@/queries/attachments';
import type { TaskAttachment } from '@/db/attachments';

/**
 * Read-only list of a task's attachments, shown below the description.
 * Attachments are mirrored locally on pull (task_attachments), so this
 * renders offline. Download fetches the file with the auth token through
 * Tauri's HTTP plugin (CORS-safe, same path the API client uses) and
 * saves it via a transient object-URL anchor.
 *
 * Upload isn't wired here — Vikunja marks task.attachments read-only and
 * inline-image upload was parked (#38); this is the display half.
 */
export function AttachmentList({
  taskLocalId,
  taskServerId,
}: {
  taskLocalId: string;
  taskServerId: number | null;
}) {
  const { data: attachments = [] } = useTaskAttachments(taskLocalId);
  const [busyId, setBusyId] = useState<number | null>(null);

  if (attachments.length === 0) return null;

  const download = async (att: TaskAttachment) => {
    if (taskServerId == null || busyId != null) return;
    setBusyId(att.serverId);
    try {
      const { serverUrl, token } = getAuthSnapshot();
      const base = (serverUrl ?? '').replace(/\/+$/, '');
      const url = `${base}/api/v1/tasks/${taskServerId}/attachments/${att.serverId}`;
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      // Tauri's HTTP plugin avoids the tauri://localhost CORS wall; fall
      // back to native fetch in the browser-only dev server.
      const isTauri =
        typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      const doFetch = isTauri
        ? (await import('@tauri-apps/plugin-http')).fetch
        : globalThis.fetch;

      const res = await doFetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();

      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = att.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.error('[attachments] download failed:', err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-4">
      <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <Paperclip className="h-3 w-3" />
        Attachments
        <span className="font-normal">{attachments.length}</span>
      </h3>
      <ul className="space-y-1">
        {attachments.map((att) => (
          <li
            key={att.serverId}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs"
          >
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
            <span className="min-w-0 flex-1 truncate" title={att.fileName}>
              {att.fileName}
            </span>
            {att.fileSize != null ? (
              <span className="shrink-0 text-[var(--color-muted-foreground)]">
                {formatBytes(att.fileSize)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void download(att)}
              disabled={taskServerId == null || busyId != null}
              aria-label={`Download ${att.fileName}`}
              className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-40 cursor-pointer"
            >
              {busyId === att.serverId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
