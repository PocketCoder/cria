/**
 * Attachment ops: queued upload (outbox + side-store), delete, auth-fetch
 * blob.
 *
 * Why not the OpenAPI client (`src/api/client.ts`): the upload endpoint
 * is multipart/form-data and the download is an arbitrary blob; neither
 * is well-modelled by openapi-typescript. We hand-roll the calls and use
 * the same Tauri-HTTP-or-native-fetch pattern as `AttachmentList`'s
 * download (browsers in `pnpm dev` go straight to `fetch`; the Tauri
 * webview goes through `@tauri-apps/plugin-http` to dodge the
 * `tauri://localhost` CORS wall).
 *
 * URL shape — `<serverUrl>/api/v1/tasks/{taskId}/attachments/{attId}` —
 * is critical: it's what we insert as the `<img src>` in descriptions
 * so Vikunja-web's CustomImage extension (and our own) recognise it as
 * an auth-required attachment and swap the src for a blob URL. We write
 * v1 because that's the API Cria talks to and every Vikunja-web release
 * recognises it (up to v2.6.0 it is the only shape they match). We *read*
 * the v2 shape too: v2.7.0 writes `<root>/api/v2/tasks/…`.
 */
import { nanoid } from 'nanoid';
import { getAuthSnapshot } from '@/auth/store';
import { platformFetch } from '@/api/client';
import { ApiError, NetworkError, buildApiError } from '@/api/errors';
import { saveBlob } from '@/lib/download';
import {
  findPendingAttachmentRefs,
  replacePendingAttachmentRef,
} from '@/lib/pendingAttachmentRef';
import {
  deleteAttachmentLocal,
  discardPendingAttachment,
  insertPendingAttachment,
  listUploadedAttachments,
} from '@/db/attachments';
import { deleteBlob, writeBlob } from '@/tauri/blobStore';
import {
  taskAttachmentSchema,
  type TaskAttachmentResponse,
} from '@/domain/task';

interface UploadResult {
  success: TaskAttachmentResponse[];
  errors: { code?: number; message?: string }[];
}

function authHeaders(): Record<string, string> {
  const { token } = getAuthSnapshot();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiBase(): string {
  const { serverUrl } = getAuthSnapshot();
  return (serverUrl ?? '').replace(/\/+$/, '');
}

/** Absolute `<img src>`-ready URL for an attachment on this server. */
export function buildAttachmentUrl(
  taskServerId: number,
  attachmentServerId: number,
): string {
  return `${apiBase()}/api/v1/tasks/${taskServerId}/attachments/${attachmentServerId}`;
}

/**
 * An inline attachment image's path below the server root. Vikunja-web
 * writes `/api/v1/…` in every release up to v2.6.0 and `/api/v2/…` from
 * v2.7.0, whose matcher also accepts the bare `/tasks/…` form. Same set
 * here, so an image either web version stored loads in Cria. A trailing
 * slash, query or fragment doesn't change which file it is.
 */
const ATTACHMENT_PATH =
  /^(?:\/api\/v[12])?\/tasks\/\d+\/attachments\/\d+\/?(?:[?#].*)?$/;

/** True if `src` points at an attachment on the currently-signed-in
 * server (i.e. it should be auth-fetched, not loaded directly). Any API
 * version is fine: the fetch rebuilds the URL from the ids. */
export function isAttachmentUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  const base = apiBase();
  if (!base || !src.startsWith(base)) return false;
  return ATTACHMENT_PATH.test(src.slice(base.length));
}

/** Parse a `(taskId, attId)` pair from an attachment URL, or null if it
 * doesn't look like one. */
export function parseAttachmentUrl(
  src: string,
): { taskServerId: number; attachmentServerId: number } | null {
  // Tolerant of extra path/query — split on '/tasks/' then read the two ids.
  const m = src.match(/\/tasks\/(\d+)\/attachments\/(\d+)/);
  if (!m) return null;
  return {
    taskServerId: Number(m[1]),
    attachmentServerId: Number(m[2]),
  };
}

/**
 * Attach a file to a task, offline-first. The bytes go to the side-store and
 * a pending row plus an outbox upload op go to the DB, so the list shows the
 * file at once and the outbox drain uploads it: straight away when online,
 * after reconnecting otherwise (the bytes survive an app restart). Works for
 * a task that hasn't synced yet, as the op waits for the task's create.
 *
 * Returns the attachment's local id (the key of `cria://pending/{id}`).
 */
export async function queueAttachmentUpload(
  taskLocalId: string,
  file: File,
): Promise<string> {
  const localId = nanoid();
  await writeBlob(localId, new Uint8Array(await file.arrayBuffer()));
  try {
    await insertPendingAttachment({
      taskLocalId,
      attachmentLocalId: localId,
      fileName: file.name || 'attachment',
      mime: file.type || 'application/octet-stream',
      size: file.size,
      bytesPath: localId,
    });
  } catch (err) {
    await deleteBlob(localId).catch(() => undefined);
    throw err;
  }
  return localId;
}

/** Remove a queued (or failed) upload: the row, its op and its bytes. */
export async function cancelAttachmentUpload(attachmentLocalId: string): Promise<void> {
  const bytesPath = await discardPendingAttachment(attachmentLocalId);
  if (bytesPath) {
    await deleteBlob(bytesPath).catch((err) =>
      console.warn('[attachments] could not delete queued bytes:', err),
    );
  }
}

/**
 * PUT one file to `/tasks/{id}/attachments` and return the created
 * attachment. Called by the outbox executor (sync/push/attachment.ts).
 *
 * Errors are classified the way `callApi` classifies them, so the drain
 * backs off on a network failure or 5xx and dead-letters a 4xx. Vikunja
 * reports a rejected file (too large, say) as a 200 with an `errors` entry;
 * that is a permanent failure too.
 *
 * Note the verb: Vikunja's v1 routes attachment upload as **PUT**.
 */
export async function putAttachmentFile(
  taskServerId: number,
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  mime: string,
): Promise<TaskAttachmentResponse> {
  const form = new FormData();
  // Vikunja's handler reads form.File["files"], so 'files' plural.
  form.append('files', new Blob([bytes], { type: mime }), fileName);

  let res: Response;
  try {
    res = await platformFetch(
      `${apiBase()}/api/v1/tasks/${taskServerId}/attachments`,
      // No Content-Type: the multipart boundary header is generated.
      { method: 'PUT', headers: authHeaders(), body: form },
    );
  } catch (err) {
    if (err instanceof NetworkError) throw err;
    throw new NetworkError(err instanceof Error ? err.message : String(err), err);
  }
  if (!res.ok) {
    throw buildApiError(res.status, await res.text().catch(() => ''));
  }

  const payload = (await res.json()) as UploadResult;
  const parsed = taskAttachmentSchema.safeParse(payload.success?.[0]);
  if (!parsed.success) {
    const first = payload.errors?.[0];
    throw new ApiError(
      res.status,
      first?.code ?? null,
      `upload rejected: ${first?.message ?? 'no attachment in the response'}`,
      false,
    );
  }
  return parsed.data;
}

/**
 * Swap `cria://pending/{id}` references whose upload has finished for the
 * real attachment URL. The task and comment push run text through this, so
 * a placeholder saved after its upload landed (the editor was still open,
 * say) never reaches the server. References still pending are left alone.
 */
export async function resolveUploadedPendingRefs(
  html: string | null,
): Promise<string | null> {
  const ids = findPendingAttachmentRefs(html);
  if (!html || ids.length === 0) return html;
  let out = html;
  for (const a of await listUploadedAttachments(ids)) {
    out = replacePendingAttachmentRef(
      out,
      a.localId,
      buildAttachmentUrl(a.taskServerId, a.serverId),
    );
  }
  return out;
}

/** Delete a server-side attachment + drop it from the local mirror. */
export async function deleteAttachment(
  taskServerId: number,
  taskLocalId: string,
  attachmentServerId: number,
): Promise<void> {
  const res = await platformFetch(
    `${apiBase()}/api/v1/tasks/${taskServerId}/attachments/${attachmentServerId}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  // 404 means it's already gone server-side — drop the local row anyway.
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `deleteAttachment: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }
  await deleteAttachmentLocal(taskLocalId, attachmentServerId);
}

/**
 * Auth-fetch an attachment's bytes as a Blob. Used by:
 *  - download flow (AttachmentList) — pipe to an `<a download>`
 *  - inline-image render (CustomImage extension) — wrap in
 *    `URL.createObjectURL` so the `<img>` can display it
 *  - lightbox preview
 */
export async function fetchAttachmentBlob(
  taskServerId: number,
  attachmentServerId: number,
): Promise<Blob> {
  const res = await platformFetch(
    buildAttachmentUrl(taskServerId, attachmentServerId),
    { headers: authHeaders() },
  );
  if (!res.ok) {
    throw new Error(`fetchAttachmentBlob: HTTP ${res.status}`);
  }
  return res.blob();
}

/**
 * Auth-fetch the attachment and trigger a browser download via a
 * synthetic anchor click. Centralised so the AttachmentList row and
 * ImageLightbox don't each maintain their own blob → object-URL → anchor
 * → revokeObjectURL choreography.
 */
export async function downloadAttachment(
  taskServerId: number,
  attachmentServerId: number,
  fileName: string,
): Promise<void> {
  const blob = await fetchAttachmentBlob(taskServerId, attachmentServerId);
  saveBlob(blob, fileName);
}
