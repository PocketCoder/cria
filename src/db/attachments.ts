import { exec, getDb, withTx } from './index';
import { notify } from './bus';
import type { TaskAttachmentResponse } from '@/domain/task';

export interface TaskAttachment {
  /** models.TaskAttachment.id — used to build the download URL. */
  serverId: number;
  fileId: number | null;
  fileName: string;
  fileSize: number | null;
  mime: string | null;
  createdAt: string | null;
}

interface AttachmentRow {
  server_id: number;
  file_id: number | null;
  file_name: string | null;
  file_size: number | null;
  mime: string | null;
  created_at: string | null;
}

/**
 * Replace the local mirror of a task's attachments with the server's set.
 * Read-only sync path — silent (no notify), like
 * replaceTaskLabelsFromServer. Called from the task pull.
 *
 * Atomic: DELETE + INSERTs ride one transaction so a concurrent reader
 * can't observe zero rows between the DELETE and the first INSERT.
 */
export async function replaceTaskAttachmentsFromServer(
  taskLocalId: string,
  attachments: TaskAttachmentResponse[],
): Promise<void> {
  await withTx(async (tx) => {
    await tx.execute(`DELETE FROM task_attachments WHERE task_local_id = ?`, [
      taskLocalId,
    ]);
    for (const a of attachments) {
      await tx.execute(
        `INSERT OR REPLACE INTO task_attachments
           (task_local_id, server_id, file_id, file_name, file_size, mime, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
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
    `SELECT server_id, file_id, file_name, file_size, mime, created_at
       FROM task_attachments
      WHERE task_local_id = ?
      ORDER BY created_at ASC, server_id ASC`,
    [taskLocalId],
  );
  return rows.map((r) => ({
    serverId: r.server_id,
    fileId: r.file_id,
    fileName: r.file_name ?? 'attachment',
    fileSize: r.file_size,
    mime: r.mime,
    createdAt: r.created_at,
  }));
}

/**
 * Mirror a single server-returned attachment into the local store and
 * fire the 'tasks' bus event so the detail card refreshes. Used by the
 * upload path after a successful PUT — saves us a full pull just to
 * surface a freshly-uploaded file.
 */
export async function upsertAttachmentLocal(
  taskLocalId: string,
  attachment: TaskAttachmentResponse,
): Promise<void> {
  await exec(
    `INSERT OR REPLACE INTO task_attachments
       (task_local_id, server_id, file_id, file_name, file_size, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      taskLocalId,
      attachment.id,
      attachment.file?.id ?? null,
      attachment.file?.name ?? null,
      attachment.file?.size ?? null,
      attachment.file?.mime ?? null,
      attachment.created ?? null,
    ],
  );
  notify('tasks');
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
