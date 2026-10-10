import { nanoid } from 'nanoid';
import { exec, getDb, withTx } from './index';
import { notify } from './bus';
import type { TaskAttachmentResponse } from '@/domain/task';
import {
  pendingAttachmentRef,
  replacePendingAttachmentRef,
  stripPendingAttachmentImages,
} from '@/lib/pendingAttachmentRef';

/** Outbox `entity_type` / `op` of a queued upload (see sync/push/attachment.ts). */
export const ATTACHMENT_ENTITY = 'task_attachment';
export const ATTACHMENT_UPLOAD_OP = 'upload';

/** Outbox payload of a queued upload. The bytes stay in the side-store
 * (src/tauri/blobStore.ts) under `bytesPath`; only this metadata rides the
 * TEXT payload column. */
export interface AttachmentUploadPayload {
  taskLocalId: string;
  attachmentLocalId: string;
  fileName: string;
  mime: string;
  size: number;
  bytesPath: string;
}

export interface TaskAttachment {
  localId: string;
  /** models.TaskAttachment.id, used to build the download URL. Null while
   * the upload is still queued. */
  serverId: number | null;
  fileId: number | null;
  fileName: string;
  fileSize: number | null;
  mime: string | null;
  createdAt: string | null;
  /** Queued for upload; the bytes are in the local side-store. */
  pending: boolean;
  /** Pending, but its upload op has left the outbox without succeeding
   * (dead-lettered or discarded), so nothing will upload it on its own. */
  uploadFailed: boolean;
}

interface AttachmentRow {
  local_id: string;
  server_id: number | null;
  file_id: number | null;
  file_name: string | null;
  file_size: number | null;
  mime: string | null;
  created_at: string | null;
  pending: number;
  queued: number;
}

/**
 * Mirror the server's attachment set for a task. Read-only sync path, so
 * silent (no notify), like replaceTaskLabelsFromServer. Called from the task
 * pull.
 *
 * Pending rows are local-only (not on the server yet) and are left alone.
 * Mirrored rows are upserted on (task_local_id, server_id) so they keep
 * their local_id across pulls; rows the server no longer has are dropped.
 * One transaction, so a reader never sees a half-applied set.
 */
export async function replaceTaskAttachmentsFromServer(
  taskLocalId: string,
  attachments: TaskAttachmentResponse[],
): Promise<void> {
  const keep = attachments.map((a) => a.id);
  await withTx(async (tx) => {
    await tx.execute(
      `DELETE FROM task_attachments
        WHERE task_local_id = ? AND pending = 0
          ${keep.length > 0 ? `AND server_id NOT IN (${keep.map(() => '?').join(', ')})` : ''}`,
      [taskLocalId, ...keep],
    );
    for (const a of attachments) {
      await tx.execute(
        `INSERT INTO task_attachments
           (local_id, task_local_id, server_id, file_id, file_name, file_size,
            mime, created_at, pending, bytes_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
         ON CONFLICT(task_local_id, server_id) DO UPDATE SET
           file_id    = excluded.file_id,
           file_name  = excluded.file_name,
           file_size  = excluded.file_size,
           mime       = excluded.mime,
           created_at = excluded.created_at`,
        [
          nanoid(),
          taskLocalId,
          a.id,
          a.file?.id ?? null,
          a.file?.name ?? null,
          a.file?.size ?? null,
          a.file?.mime ?? null,
          a.created ?? null,
        ],
      );
    }
  });
}

export async function listAttachmentsForTask(
  taskLocalId: string,
): Promise<TaskAttachment[]> {
  const db = await getDb();
  const rows = await db.select<AttachmentRow[]>(
    `SELECT a.local_id, a.server_id, a.file_id, a.file_name, a.file_size,
            a.mime, a.created_at, a.pending,
            EXISTS (SELECT 1 FROM outbox o
                     WHERE o.entity_type = ? AND o.entity_local_id = a.local_id) AS queued
       FROM task_attachments a
      WHERE a.task_local_id = ?
      ORDER BY a.created_at ASC, a.server_id ASC`,
    [ATTACHMENT_ENTITY, taskLocalId],
  );
  return rows.map((r) => ({
    localId: r.local_id,
    serverId: r.server_id,
    fileId: r.file_id,
    fileName: r.file_name ?? 'attachment',
    fileSize: r.file_size,
    mime: r.mime,
    createdAt: r.created_at,
    pending: r.pending === 1,
    uploadFailed: r.pending === 1 && r.queued === 0,
  }));
}

export interface AttachmentLookup {
  localId: string;
  taskLocalId: string;
  serverId: number | null;
  /** The owning task's server id, if it has synced. */
  taskServerId: number | null;
  mime: string | null;
  pending: boolean;
  bytesPath: string | null;
}

/** One attachment by local id (null if gone). Feeds the inline-image
 * resolver for `cria://pending/{localId}` references. */
export async function getAttachmentByLocalId(
  localId: string,
): Promise<AttachmentLookup | null> {
  const db = await getDb();
  const [row] = await db.select<
    {
      local_id: string;
      task_local_id: string;
      server_id: number | null;
      task_server_id: number | null;
      mime: string | null;
      pending: number;
      bytes_path: string | null;
    }[]
  >(
    `SELECT a.local_id, a.task_local_id, a.server_id, t.server_id AS task_server_id,
            a.mime, a.pending, a.bytes_path
       FROM task_attachments a
       LEFT JOIN tasks t ON t.local_id = a.task_local_id
      WHERE a.local_id = ?`,
    [localId],
  );
  if (!row) return null;
  return {
    localId: row.local_id,
    taskLocalId: row.task_local_id,
    serverId: row.server_id,
    taskServerId: row.task_server_id,
    mime: row.mime,
    pending: row.pending === 1,
    bytesPath: row.bytes_path,
  };
}

/** Of `localIds`, the attachments that have uploaded, with the server ids
 * needed to build their URLs. */
export async function listUploadedAttachments(
  localIds: string[],
): Promise<{ localId: string; serverId: number; taskServerId: number }[]> {
  if (localIds.length === 0) return [];
  const db = await getDb();
  const rows = await db.select<
    { local_id: string; server_id: number; task_server_id: number }[]
  >(
    `SELECT a.local_id, a.server_id, t.server_id AS task_server_id
       FROM task_attachments a
       JOIN tasks t ON t.local_id = a.task_local_id
      WHERE a.local_id IN (${localIds.map(() => '?').join(', ')})
        AND a.server_id IS NOT NULL
        AND t.server_id IS NOT NULL`,
    localIds,
  );
  return rows.map((r) => ({
    localId: r.local_id,
    serverId: r.server_id,
    taskServerId: r.task_server_id,
  }));
}

/**
 * User path: record a file the user just attached. Inserts the pending row
 * and its upload op in one transaction, then notifies so the list shows the
 * row and the outbox drain picks the op up (immediately when online).
 *
 * The caller writes the bytes to the side-store under `bytesPath` first, so
 * the drain never sees an op without its bytes.
 */
export async function insertPendingAttachment(
  payload: AttachmentUploadPayload,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `INSERT INTO task_attachments
         (local_id, task_local_id, server_id, file_id, file_name, file_size,
          mime, created_at, pending, bytes_path)
       VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 1, ?)`,
      [
        payload.attachmentLocalId,
        payload.taskLocalId,
        payload.fileName,
        payload.size,
        payload.mime,
        now,
        payload.bytesPath,
      ],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        ATTACHMENT_ENTITY,
        payload.attachmentLocalId,
        ATTACHMENT_UPLOAD_OP,
        JSON.stringify(payload),
        now,
      ],
    );
  });
  notify('tasks');
  notify('outbox');
}

/**
 * Push path: the server accepted a queued upload. Turns the pending row into
 * a mirror of the server attachment and swaps every `cria://pending/{id}`
 * reference in the task's description and comments for `url`.
 *
 * Rewritten text reaches the server by one of two routes. A dirty row still
 * has a create/update op queued behind this one (FIFO), and that op reads
 * the row when it drains, so the rewrite rides along. A clean row was already
 * pushed with the placeholder (an upload retried from the dead-letter list,
 * say), so it gets marked dirty and a fresh update op.
 */
export async function finaliseAttachmentUpload(args: {
  attachmentLocalId: string;
  taskLocalId: string;
  uploaded: TaskAttachmentResponse;
  url: string;
}): Promise<void> {
  const { attachmentLocalId, taskLocalId, uploaded, url } = args;
  const ref = pendingAttachmentRef(attachmentLocalId);
  const now = new Date().toISOString();
  let commentsChanged = false;
  let queued = false;

  await withTx(async (tx) => {
    // Reads go first: a SELECT inside withTx sees pre-batch state, and the
    // serial queue keeps other writes out until this batch commits.
    const [task] = await tx.select<{ description: string | null; dirty: number }[]>(
      `SELECT description, dirty FROM tasks WHERE local_id = ? LIMIT 1`,
      [taskLocalId],
    );
    const comments = await tx.select<{ local_id: string; comment: string; dirty: number }[]>(
      `SELECT local_id, comment, dirty FROM task_comments
        WHERE task_local_id = ? AND deleted = 0 AND instr(comment, ?) > 0`,
      [taskLocalId, ref],
    );

    // A pull between the PUT and now may have mirrored the attachment
    // already; keep this row (its local id is what the UI and refs know).
    await tx.execute(
      `DELETE FROM task_attachments
        WHERE task_local_id = ? AND server_id = ? AND local_id <> ?`,
      [taskLocalId, uploaded.id, attachmentLocalId],
    );
    await tx.execute(
      `UPDATE task_attachments
          SET server_id  = ?,
              file_id    = ?,
              file_name  = COALESCE(?, file_name),
              file_size  = COALESCE(?, file_size),
              mime       = COALESCE(?, mime),
              created_at = COALESCE(?, created_at),
              pending    = 0,
              bytes_path = NULL
        WHERE local_id = ?`,
      [
        uploaded.id,
        uploaded.file?.id ?? null,
        uploaded.file?.name ?? null,
        uploaded.file?.size ?? null,
        uploaded.file?.mime ?? null,
        uploaded.created ?? null,
        attachmentLocalId,
      ],
    );

    // A row counts as changed only if the exact reference was replaced: the
    // instr() prefilter on comments also matches `…/att10` for `…/att1`.
    const description = task?.description
      ? replacePendingAttachmentRef(task.description, attachmentLocalId, url)
      : null;
    if (task && description !== null && description !== task.description) {
      if (task.dirty === 1) {
        await tx.execute(`UPDATE tasks SET description = ? WHERE local_id = ?`, [
          description,
          taskLocalId,
        ]);
      } else {
        await tx.execute(
          `UPDATE tasks SET description = ?, updated_at = ?, dirty = 1 WHERE local_id = ?`,
          [description, now, taskLocalId],
        );
        await tx.execute(
          `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
           VALUES ('task', ?, 'update', ?, ?)`,
          [taskLocalId, JSON.stringify({ description }), now],
        );
        queued = true;
      }
    }

    for (const c of comments) {
      const comment = replacePendingAttachmentRef(c.comment, attachmentLocalId, url);
      if (comment === c.comment) continue;
      commentsChanged = true;
      if (c.dirty === 1) {
        await tx.execute(`UPDATE task_comments SET comment = ? WHERE local_id = ?`, [
          comment,
          c.local_id,
        ]);
      } else {
        await tx.execute(
          `UPDATE task_comments SET comment = ?, updated_at = ?, dirty = 1 WHERE local_id = ?`,
          [comment, now, c.local_id],
        );
        await tx.execute(
          `INSERT INTO outbox (entity_type, entity_local_id, op, payload, attempts, created_at)
           VALUES ('task_comment', ?, 'update', '{}', 0, ?)`,
          [c.local_id, now],
        );
        queued = true;
      }
    }
  });

  notify('tasks');
  if (commentsChanged) notify('comments');
  if (queued) notify('outbox');
}

/**
 * User path: drop a pending upload (the user removed the row, or the push
 * found its task gone). Deletes the row and any queued or dead-lettered
 * upload op. Returns the side-store key so the caller can delete the bytes.
 *
 * Every inline `cria://pending/{id}` image of it is stripped from task
 * descriptions and comments in the same transaction, as there will never
 * be a URL to swap in. Each changed row is saved the way a user edit is
 * (dirty, plus an update op) so the server copy loses it too. A comment
 * that hasn't synced gets no op: its queued create reads the row, and an
 * update can't run before the comment exists on the server.
 *
 * If the drain is mid-upload for this row, the server may still get the
 * file; the next pull then mirrors it like any other attachment.
 */
export async function discardPendingAttachment(localId: string): Promise<string | null> {
  const ref = pendingAttachmentRef(localId);
  const now = new Date().toISOString();
  let bytesPath: string | null = null;
  let commentsChanged = false;

  await withTx(async (tx) => {
    // Reads first: a SELECT inside withTx sees pre-batch state.
    const [row] = await tx.select<{ bytes_path: string | null; pending: number }[]>(
      `SELECT bytes_path, pending FROM task_attachments WHERE local_id = ?`,
      [localId],
    );
    // An uploaded attachment keeps its row, and its references resolve.
    const strip = !row || row.pending === 1;
    bytesPath = row?.pending === 1 ? row.bytes_path : null;
    const tasks = strip
      ? await tx.select<{ local_id: string; description: string }[]>(
          `SELECT local_id, description FROM tasks
            WHERE deleted = 0 AND instr(description, ?) > 0`,
          [ref],
        )
      : [];
    // Comments of a task that's gone or being deleted are left alone: an
    // update op for them could never find the task on the server.
    const comments = strip
      ? await tx.select<{ local_id: string; comment: string; server_id: number }[]>(
          `SELECT c.local_id, c.comment, c.server_id FROM task_comments c
             JOIN tasks t ON t.local_id = c.task_local_id AND t.deleted = 0
            WHERE c.deleted = 0 AND instr(c.comment, ?) > 0`,
          [ref],
        )
      : [];

    await tx.execute(`DELETE FROM task_attachments WHERE local_id = ? AND pending = 1`, [localId]);
    await tx.execute(`DELETE FROM outbox WHERE entity_type = ? AND entity_local_id = ?`, [
      ATTACHMENT_ENTITY,
      localId,
    ]);
    await tx.execute(
      `DELETE FROM outbox_dead_letter WHERE entity_type = ? AND entity_local_id = ?`,
      [ATTACHMENT_ENTITY, localId],
    );

    // instr() also matches `…/att10` for `…/att1`; the strip compares ids.
    for (const t of tasks) {
      const description = stripPendingAttachmentImages(t.description, localId);
      if (description === t.description) continue;
      await tx.execute(
        `UPDATE tasks SET description = ?, updated_at = ?, dirty = 1 WHERE local_id = ?`,
        [description, now, t.local_id],
      );
      await tx.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('task', ?, 'update', ?, ?)`,
        [t.local_id, JSON.stringify({ description }), now],
      );
    }

    for (const c of comments) {
      const comment = stripPendingAttachmentImages(c.comment, localId);
      if (comment === c.comment) continue;
      commentsChanged = true;
      await tx.execute(
        `UPDATE task_comments SET comment = ?, updated_at = ?, dirty = 1 WHERE local_id = ?`,
        [comment, now, c.local_id],
      );
      if (c.server_id === 0) continue;
      await tx.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, attempts, created_at)
         VALUES ('task_comment', ?, 'update', '{}', 0, ?)`,
        [c.local_id, now],
      );
    }
  });
  notify('tasks');
  if (commentsChanged) notify('comments');
  notify('outbox');
  return bytesPath;
}

/** Of `localIds`, those with no attachment row at all: the upload was
 * cancelled (or its task removed), so nothing will ever resolve them. */
export async function listMissingAttachments(localIds: string[]): Promise<string[]> {
  if (localIds.length === 0) return [];
  const db = await getDb();
  const rows = await db.select<{ local_id: string }[]>(
    `SELECT local_id FROM task_attachments
      WHERE local_id IN (${localIds.map(() => '?').join(', ')})`,
    localIds,
  );
  const present = new Set(rows.map((r) => r.local_id));
  return localIds.filter((id) => !present.has(id));
}

/**
 * True if anything local may still need the side-store blob under `key`:
 * an attachment row naming it as `bytes_path`, a pending row whose local id
 * it is (the key queueAttachmentUpload writes under), or an outbox or
 * dead-letter op that mentions it anywhere. The payload test is a plain
 * substring match, so it errs towards keeping the file. One statement reads
 * one snapshot, so an op moving between the outbox and the dead-letter list
 * can't slip past it. Feeds the orphan sweep (src/sync/blobSweep.ts).
 */
export async function isBlobReferenced(key: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select<{ referenced: number }[]>(
    `SELECT EXISTS (SELECT 1 FROM task_attachments
                     WHERE bytes_path = ? OR (pending = 1 AND local_id = ?))
         OR EXISTS (SELECT 1 FROM outbox
                     WHERE entity_local_id = ? OR instr(payload, ?) > 0)
         OR EXISTS (SELECT 1 FROM outbox_dead_letter
                     WHERE entity_local_id = ? OR instr(payload, ?) > 0)
         AS referenced`,
    [key, key, key, key, key, key],
  );
  // No answer counts as a reference: the sweep keeps what it can't rule out.
  return !row || Number(row.referenced) !== 0;
}

/** Remove a single attachment from the local mirror. */
export async function deleteAttachmentLocal(
  taskLocalId: string,
  attachmentServerId: number,
): Promise<void> {
  await exec(
    `DELETE FROM task_attachments WHERE task_local_id = ? AND server_id = ?`,
    [taskLocalId, attachmentServerId],
  );
  notify('tasks');
}

/** local_ids of every task that has ≥1 attachment — drives the row
 * paperclip indicator without a per-row fetch. */
export async function listTaskLocalIdsWithAttachments(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ task_local_id: string }[]>(
    `SELECT DISTINCT task_local_id FROM task_attachments`,
  );
  return rows.map((r) => r.task_local_id);
}
