import { useEffect, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { fetchAttachmentBlob } from '@/sync/attachments';
import { getAttachmentObjectUrl } from './tiptapImageExtension';

/**
 * Full-size image viewer for an attachment. Auth-fetches the blob
 * through the shared cache (so opening a row that already has a
 * thumbnail is instant) and shows it in a fixed-position modal.
 *
 * - Esc / backdrop click closes.
 * - "Download" button reuses the same blob — no second fetch.
 * - No portal: we render at the bottom of the document tree via fixed
 *   positioning + a high z-index, which is enough for the detail card
 *   to be covered. If we ever need it inside a transformed ancestor
 *   we'll swap to createPortal.
 */
export function ImageLightbox({
  taskServerId,
  attachmentServerId,
  fileName,
  onClose,
}: {
  taskServerId: number;
  attachmentServerId: number;
  fileName: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAttachmentObjectUrl(taskServerId, attachmentServerId).then(
      (u) => {
        if (!cancelled) setUrl(u);
      },
      (e) => {
        if (!cancelled) setErr(String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [taskServerId, attachmentServerId]);

  // Esc to close. Capture so we win over any background editor that
  // might also be listening for Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const downloadCurrent = async () => {
    try {
      // If we already have an object URL we *could* trigger the
      // download anchor against it — but Safari refuses cross-document
      // object-URL downloads in some setups, and a fresh blob keeps
      // the code path identical to AttachmentRow's download.
      const blob = await fetchAttachmentBlob(taskServerId, attachmentServerId);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      console.error('[lightbox] download failed:', e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-full"
        // Don't close when clicking the image itself / chrome.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-2 right-0 flex translate-y-[-100%] gap-1">
          <button
            type="button"
            onClick={() => void downloadCurrent()}
            aria-label="Download"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 cursor-pointer"
            title={fileName}
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {err ? (
          <div className="rounded-md bg-white/10 px-4 py-3 text-sm text-white">
            Failed to load image: {err}
          </div>
        ) : url ? (
          <img
            src={url}
            alt={fileName}
            className="max-h-[85vh] max-w-[90vw] rounded-md object-contain shadow-2xl"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-md bg-white/5">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </div>
    </div>
  );
}
