/**
 * Server-side attachment ops — upload, delete, auth-fetch blob.
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
 * an auth-required attachment and swap the src for a blob URL.
 */
import { getAuthSnapshot } from '@/auth/store';
import {
  upsertAttachmentLocal,
  deleteAttachmentLocal,
} from '@/db/attachments';
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

/** True if `src` points at an attachment on the currently-signed-in
 * server (i.e. it should be auth-fetched, not loaded directly). */
export function isAttachmentUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  const base = apiBase();
  if (!base) return false;
  return src.startsWith(`${base}/api/v1/tasks/`) && src.includes('/attachments/');
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
 * Pick the right fetch (`@tauri-apps/plugin-http` inside the Tauri
 * webview, native `fetch` in the browser/dev server). Centralised so
 * upload + download + delete don't each maintain the branch.
 */
async function pickFetch(): Promise<typeof fetch> {
  const isTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!isTauri) return globalThis.fetch;
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  return tauriFetch as unknown as typeof fetch;
}

/**
 * Upload one or more files to a task as attachments. Mirrors each
 * returned attachment into the local task_attachments table so the
 * detail card updates without waiting for the next pull.
 *
 * Returns the list of successfully-created attachments (already parsed
 * through `taskAttachmentSchema`). The server's `errors` array is
 * logged but not thrown — partial-success is the upstream behaviour
 * (one bad file in a batch shouldn't fail the rest).
 *
 * Note the verb: Vikunja's v1 routes attachment upload as **PUT**
 * (not POST). v2 may differ when it lands, but we're on v1.
 */
export async function uploadAttachment(
  taskServerId: number,
  taskLocalId: string,
  files: File[] | FileList,
): Promise<TaskAttachmentResponse[]> {
  if (!taskServerId) throw new Error('uploadAttachment: task has no server id');
  const list = Array.from(files);
  if (list.length === 0) return [];

  const form = new FormData();
  for (const f of list) {
    // Vikunja's handler reads form.File["files"] — must be 'files' plural.
    form.append('files', f, f.name);
  }

  const doFetch = await pickFetch();
  const res = await doFetch(
    `${apiBase()}/api/v1/tasks/${taskServerId}/attachments`,
    {
      method: 'PUT',
      headers: authHeaders(), // do NOT set Content-Type — the Request boundary header is generated
      body: form,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `uploadAttachment: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }

  const payload = (await res.json()) as UploadResult;
  if (payload.errors?.length) {
    console.warn('[attachments] upload partial errors:', payload.errors);
  }

  const parsed: TaskAttachmentResponse[] = [];
  for (const raw of payload.success ?? []) {
    const r = taskAttachmentSchema.safeParse(raw);
    if (r.success) parsed.push(r.data);
    else console.warn('[attachments] skipping malformed upload result:', r.error);
  }

  for (const a of parsed) {
    await upsertAttachmentLocal(taskLocalId, a);
  }
  return parsed;
}

/** Delete a server-side attachment + drop it from the local mirror. */
export async function deleteAttachment(
  taskServerId: number,
  taskLocalId: string,
  attachmentServerId: number,
): Promise<void> {
  const doFetch = await pickFetch();
  const res = await doFetch(
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
  const doFetch = await pickFetch();
  const res = await doFetch(buildAttachmentUrl(taskServerId, attachmentServerId), {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`fetchAttachmentBlob: HTTP ${res.status}`);
  }
  return res.blob();
}
