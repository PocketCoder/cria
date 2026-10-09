import type { ApiClient } from '@/api/client';
import { exec, type Database } from '@/db';
import { ApiError } from '@/api/errors';
import {
  ATTACHMENT_UPLOAD_OP,
  discardPendingAttachment,
  finaliseAttachmentUpload,
  type AttachmentUploadPayload,
} from '@/db/attachments';
import { taskAttachmentSchema, type TaskAttachmentResponse } from '@/domain/task';
import { buildAttachmentUrl, putAttachmentFile } from '@/sync/attachments';
import { deleteBlob, isBlobMissing, readBlob } from '@/tauri/blobStore';
import { type OutboxRow } from './shared';

/** Payload as stored, plus the upload result cached after a successful PUT. */
type StoredPayload = AttachmentUploadPayload & { _uploaded?: unknown };

/**
 * `task_attachment`·`upload`: send a queued file to the server.
 *
 * Reads the bytes back from the side-store, PUTs them, then turns the
 * pending row into a mirror of the server attachment, rewrites any inline
 * `cria://pending/{id}` reference in the task description and comments, and
 * deletes the bytes. Failures throw for the drain to classify: a network
 * error or 5xx backs off and retries (the bytes stay put), a 4xx or missing
 * bytes dead-letters, and an unsynced task is a dependency wait.
 */
export async function executeAttachmentOp(
  _client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  if (op.op !== ATTACHMENT_UPLOAD_OP) return;
  const payload = parsePayload(op.payload);
  const { attachmentLocalId, taskLocalId, bytesPath } = payload;

  const [row] = await db.select<{ pending: number }[]>(
    `SELECT pending FROM task_attachments WHERE local_id = ? LIMIT 1`,
    [attachmentLocalId],
  );
  // Removed by the user, or finalised by an earlier run that stopped before
  // the drain deleted this op. Either way only the bytes are left to tidy.
  if (!row || row.pending === 0) {
    await dropBytes(bytesPath);
    return;
  }

  const [task] = await db.select<{ server_id: number | null; deleted: number }[]>(
    `SELECT server_id, deleted FROM tasks WHERE local_id = ? LIMIT 1`,
    [taskLocalId],
  );
  // The task is gone or about to be deleted: there's nothing to attach to.
  if (!task || task.deleted === 1) {
    await discardPendingAttachment(attachmentLocalId);
    await dropBytes(bytesPath);
    return;
  }
  if (!task.server_id) {
    throw new ApiError(408, null, 'task_attachment: task not synced yet', true, true);
  }

  let uploaded = cachedUpload(payload);
  if (!uploaded) {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBlob(bytesPath);
    } catch (err) {
      if (isBlobMissing(err)) {
        throw new ApiError(
          0,
          null,
          `task_attachment: the bytes of "${payload.fileName}" are missing from the local store`,
          false,
        );
      }
      throw new ApiError(0, null, `task_attachment: could not read queued bytes: ${String(err)}`, true);
    }
    uploaded = await putAttachmentFile(task.server_id, bytes, payload.fileName, payload.mime);
    // Crash-idempotent: if the app dies before the op is deleted, the retry
    // finalises from this instead of uploading the file a second time.
    await exec('UPDATE outbox SET payload = ? WHERE id = ?', [
      JSON.stringify({ ...payload, _uploaded: uploaded }),
      op.id,
    ]);
  }

  await finaliseAttachmentUpload({
    attachmentLocalId,
    taskLocalId,
    uploaded,
    url: buildAttachmentUrl(task.server_id, uploaded.id),
  });
  await dropBytes(bytesPath);
}

function parsePayload(raw: string): StoredPayload {
  let p: Partial<StoredPayload>;
  try {
    p = JSON.parse(raw) as Partial<StoredPayload>;
  } catch {
    p = {};
  }
  if (!p.attachmentLocalId || !p.taskLocalId || !p.bytesPath || !p.fileName) {
    throw new ApiError(0, null, 'task_attachment: malformed upload payload', false);
  }
  return {
    ...p,
    mime: p.mime || 'application/octet-stream',
    size: p.size ?? 0,
  } as StoredPayload;
}

function cachedUpload(payload: StoredPayload): TaskAttachmentResponse | null {
  if (payload._uploaded == null) return null;
  const parsed = taskAttachmentSchema.safeParse(payload._uploaded);
  return parsed.success ? parsed.data : null;
}

/** Best-effort: a leftover blob wastes disk but breaks nothing. */
async function dropBytes(bytesPath: string): Promise<void> {
  try {
    await deleteBlob(bytesPath);
  } catch (err) {
    console.warn('[attachments] could not delete uploaded bytes:', err);
  }
}
