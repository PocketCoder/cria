import { useEffect, useRef, useState } from 'react';
import {
  Paperclip,
  Download,
  Loader2,
  Plus,
  X,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import { useTaskAttachments } from '@/queries/attachments';
import {
  queueAttachmentUpload,
  cancelAttachmentUpload,
  deleteAttachment,
  downloadAttachment,
} from '@/sync/attachments';
import { getAttachmentObjectUrl } from './inlineImageUrls';
import { ImageLightbox } from './ImageLightbox';
import { InlineWarning } from '@/components/InlineWarning';
import { isOfflineError } from '@/lib/errors';
import type { TaskAttachment } from '@/db/attachments';

/**
 * Attachments panel: list + upload (button + drop zone) + per-row
 * delete + per-row download + click-image-to-preview.
 *
 * Uploads are offline-first: picking a file queues it through the outbox
 * (bytes in the side-store), so the row appears at once with an
 * "Uploading…" state and finalises when the drain gets it to the server.
 *
 * Render strategy — the section is now always present (not hidden when
 * empty) so the upload button is reachable on a task with zero
 * attachments. The drop zone collapses into the header when there's
 * nothing in the list yet, and into a compact strip when there are
 * existing rows, so it stays out of the way.
 */
export function AttachmentList({
  taskLocalId,
  taskServerId,
  hideHeader = false,
}: {
  taskLocalId: string;
  taskServerId: number | null;
  hideHeader?: boolean;
}) {
  const { data: attachments = [] } = useTaskAttachments(taskLocalId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  // Last upload/delete error surfaced as an inline strip. Cleared on
  // the next successful op or when the user dismisses. Uploads only fail
  // here if the file can't be read or stored locally; network failures
  // are retried by the outbox and show on the row instead.
  const [opError, setOpError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPick = () => fileInputRef.current?.click();

  const handleFiles = async (files: File[] | FileList) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setOpError(null);
    try {
      for (const file of list) await queueAttachmentUpload(taskLocalId, file);
    } catch (err) {
      console.error('[attachments] queueing upload failed:', err);
      setOpError(formatOpError(err, 'upload'));
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // CRITICAL: snapshot the FileList into a real array BEFORE clearing
    // the input. `e.target.files` is a *live* reference — setting
    // value='' empties it in WebKit, and handleFiles would see zero
    // files and silently return.
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) await handleFiles(files);
  };

  // Drag-and-drop on the whole panel. preventDefault is required on
  // both dragover and drop, otherwise the browser navigates to the
  // dropped file's URL. The `dragOver` flag is cosmetic only.
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const download = async (att: TaskAttachment) => {
    if (taskServerId == null || att.serverId == null || busyId != null) return;
    setBusyId(att.localId);
    try {
      await downloadAttachment(taskServerId, att.serverId, att.fileName);
    } catch (err) {
      console.error('[attachments] download failed:', err);
    } finally {
      setBusyId(null);
    }
  };

  // A queued upload is removed locally (row, op and bytes); an uploaded
  // attachment is deleted on the server.
  const remove = async (att: TaskAttachment) => {
    if (busyId != null) return;
    setBusyId(att.localId);
    setOpError(null);
    try {
      if (att.pending) {
        await cancelAttachmentUpload(att.localId);
      } else if (taskServerId != null && att.serverId != null) {
        await deleteAttachment(taskServerId, taskLocalId, att.serverId);
      }
    } catch (err) {
      console.error('[attachments] delete failed:', err);
      setOpError(formatOpError(err, 'delete'));
    } finally {
      setBusyId(null);
    }
  };

  const empty = attachments.length === 0;

  return (
    <section
      className={`mb-4 ${dragOver ? 'rounded-md ring-2 ring-[var(--color-primary)] ring-offset-2' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mb-1 flex items-center gap-1">
        {hideHeader ? null : (
          <h3 className="flex items-center gap-1 group-label text-[var(--color-muted-foreground)]">
            <Paperclip className="h-3 w-3" />
            Attachments
            {!empty ? <span className="font-normal">{attachments.length}</span> : null}
          </h3>
        )}
        <button
          type="button"
          onClick={onPick}
          disabled={uploading}
          title="Add attachment"
          className="ml-auto flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-40 cursor-pointer"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onFileChange}
          className="hidden"
        />
      </div>

      {opError ? (
        <InlineWarning className="mb-1" onDismiss={() => setOpError(null)}>
          {opError}
        </InlineWarning>
      ) : null}

      {empty ? (
        // Compact drop hint when there's nothing else here. Disappears
        // once an attachment exists so the list stays tight.
        <button
          type="button"
          onClick={onPick}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--color-border)] px-2 py-3 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-40 cursor-pointer"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Drop files here or click to upload
        </button>
      ) : (
        <ul className="space-y-1">
          {attachments.map((att) => (
            <AttachmentRow
              key={att.localId}
              att={att}
              taskServerId={taskServerId}
              busy={busyId === att.localId}
              onDownload={() => void download(att)}
              onDelete={() => void remove(att)}
              onPreview={() => setPreview(att)}
            />
          ))}
        </ul>
      )}

      {preview && taskServerId != null && preview.serverId != null ? (
        <ImageLightbox
          taskServerId={taskServerId}
          attachmentServerId={preview.serverId}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * One row in the list. Image attachments render a 32px thumbnail
 * (auth-fetched, cached against the same module-level map the inline
 * images use) and the whole row is clickable to open the lightbox.
 * Non-image attachments stay as paperclip + name + download.
 */
function AttachmentRow({
  att,
  taskServerId,
  busy,
  onDownload,
  onDelete,
  onPreview,
}: {
  att: TaskAttachment;
  taskServerId: number | null;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onPreview: () => void;
}) {
  const isImage = att.mime?.startsWith('image/') ?? false;
  const serverId = att.serverId;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Lazy auth-fetched thumbnail for image rows. Effect (not render-time
  // side-effect) so React doesn't kick off the promise on every paint.
  // The cache in getAttachmentObjectUrl makes re-mounts free.
  useEffect(() => {
    if (!isImage || taskServerId == null || serverId == null) return;
    let cancelled = false;
    void getAttachmentObjectUrl(taskServerId, serverId).then(
      (url) => {
        if (!cancelled) setThumbUrl(url);
      },
      (err) => console.warn('[attachments] thumbnail failed:', err),
    );
    return () => {
      cancelled = true;
    };
  }, [isImage, taskServerId, serverId]);

  if (att.pending) {
    return <PendingAttachmentRow att={att} busy={busy} onRemove={onDelete} />;
  }

  return (
    <li
      className="group flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs"
    >
      {isImage ? (
        <button
          type="button"
          onClick={onPreview}
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--color-muted)] cursor-pointer"
          aria-label={`Preview ${att.fileName}`}
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          )}
        </button>
      ) : (
        <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
      )}
      <button
        type="button"
        onClick={isImage ? onPreview : onDownload}
        className="min-w-0 flex-1 truncate text-left hover:underline cursor-pointer"
        title={att.fileName}
      >
        {att.fileName}
      </button>
      {att.fileSize != null ? (
        <span className="shrink-0 text-[var(--color-muted-foreground)]">
          {formatBytes(att.fileSize)}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onDownload}
        disabled={taskServerId == null || busy}
        aria-label={`Download ${att.fileName}`}
        className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-40 cursor-pointer"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={taskServerId == null || busy}
        aria-label={`Delete ${att.fileName}`}
        className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-warning-text)] group-hover:opacity-100 disabled:opacity-40 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/**
 * A file still in the outbox. "Uploading…" covers both an upload in flight
 * and one waiting for the connection; "Upload failed" means its op left the
 * outbox without succeeding (retry it from the sync panel, or remove it).
 * The remove button is always visible: it cancels the queued upload.
 */
function PendingAttachmentRow({
  att,
  busy,
  onRemove,
}: {
  att: TaskAttachment;
  busy: boolean;
  onRemove: () => void;
}) {
  const failed = att.uploadFailed;
  return (
    <li
      aria-busy={!failed}
      className="flex items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs"
    >
      {failed ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning-text)]" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />
      )}
      <span className="min-w-0 flex-1 truncate" title={att.fileName}>
        {att.fileName}
      </span>
      <span
        className={`shrink-0 ${failed ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-muted-foreground)]'}`}
      >
        {failed ? 'Upload failed' : 'Uploading…'}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={failed ? `Remove ${att.fileName}` : `Cancel upload of ${att.fileName}`}
        className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-warning-text)] disabled:opacity-40 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/**
 * Render an upload/delete error in a way that's actionable to the
 * user. A delete that fails offline ("error sending request for url …")
 * says so plainly instead of leaking the raw URL. Queueing an upload
 * never touches the network, so an upload error means the file couldn't
 * be read or stored locally.
 */
function formatOpError(err: unknown, verb: 'upload' | 'delete'): string {
  const msg = String(err instanceof Error ? err.message : err);
  if (verb === 'upload') return `Couldn't add the file: ${msg}`;
  if (isOfflineError(err)) {
    return "Couldn't delete — check your connection and try again.";
  }
  return `Delete failed: ${msg}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
