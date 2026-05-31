import { useRef, useState } from 'react';
import { Paperclip, Download, Loader2, Plus, X, Image as ImageIcon } from 'lucide-react';
import { useTaskAttachments } from '@/queries/attachments';
import {
  uploadAttachment,
  deleteAttachment,
  fetchAttachmentBlob,
} from '@/sync/attachments';
import { getAttachmentObjectUrl } from './tiptapImageExtension';
import { ImageLightbox } from './ImageLightbox';
import type { TaskAttachment } from '@/db/attachments';

/**
 * Attachments panel: list + upload (button + drop zone) + per-row
 * delete + per-row download + click-image-to-preview.
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
}: {
  taskLocalId: string;
  taskServerId: number | null;
}) {
  const { data: attachments = [] } = useTaskAttachments(taskLocalId);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const disabled = taskServerId == null;

  const onPick = () => fileInputRef.current?.click();

  const handleFiles = async (files: File[] | FileList) => {
    if (disabled) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      await uploadAttachment(taskServerId!, taskLocalId, list);
    } catch (err) {
      console.error('[attachments] upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (files) await handleFiles(files);
  };

  // Drag-and-drop on the whole panel. preventDefault is required on
  // both dragover and drop, otherwise the browser navigates to the
  // dropped file's URL. The `dragOver` flag is cosmetic only.
  const onDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const download = async (att: TaskAttachment) => {
    if (taskServerId == null || busyId != null) return;
    setBusyId(att.serverId);
    try {
      const blob = await fetchAttachmentBlob(taskServerId, att.serverId);
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

  const remove = async (att: TaskAttachment) => {
    if (taskServerId == null || busyId != null) return;
    setBusyId(att.serverId);
    try {
      await deleteAttachment(taskServerId, taskLocalId, att.serverId);
    } catch (err) {
      console.error('[attachments] delete failed:', err);
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
        <h3 className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          <Paperclip className="h-3 w-3" />
          Attachments
          {!empty ? <span className="font-normal">{attachments.length}</span> : null}
        </h3>
        <button
          type="button"
          onClick={onPick}
          disabled={disabled || uploading}
          title={
            disabled
              ? 'Save the task first — attachments need a server id'
              : 'Add attachment'
          }
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

      {empty ? (
        // Compact drop hint when there's nothing else here. Disappears
        // once an attachment exists so the list stays tight.
        <button
          type="button"
          onClick={onPick}
          disabled={disabled || uploading}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--color-border)] px-2 py-3 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-40 cursor-pointer"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Drop files here or click to upload
        </button>
      ) : (
        <ul className="space-y-1">
          {attachments.map((att) => (
            <AttachmentRow
              key={att.serverId}
              att={att}
              taskServerId={taskServerId}
              busy={busyId === att.serverId}
              onDownload={() => void download(att)}
              onDelete={() => void remove(att)}
              onPreview={() => setPreview(att)}
            />
          ))}
        </ul>
      )}

      {preview && taskServerId != null ? (
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
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Lazy auth-fetched thumbnail for image rows. Reuses the same cache
  // VikunjaImage / ImageLightbox use, so opening the preview is free.
  if (isImage && thumbUrl === null && taskServerId != null) {
    void getAttachmentObjectUrl(taskServerId, att.serverId).then(
      (url) => setThumbUrl(url),
      (err) => console.warn('[attachments] thumbnail failed:', err),
    );
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
        className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-warning)] group-hover:opacity-100 disabled:opacity-40 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
