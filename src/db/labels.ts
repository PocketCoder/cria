import { nanoid } from 'nanoid';
import { getDb, exec, withTx } from './index';
import { notify } from './bus';
import type { Label, LabelResponse } from '@/domain/label';

interface LabelRow {
  local_id: string;
  server_id: number | null;
  title: string;
  description: string | null;
  hex_color: string | null;
  updated_at: string;
}

function rowToLabel(row: LabelRow): Label {
  return {
    localId: row.local_id,
    serverId: row.server_id,
    title: row.title,
    description: row.description,
    hexColor: row.hex_color,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  'local_id, server_id, title, description, hex_color, updated_at';

export async function listLabels(): Promise<Label[]> {
  const db = await getDb();
  const rows = await db.select<LabelRow[]>(
    `SELECT ${SELECT_COLS} FROM labels
      WHERE deleted = 0
   ORDER BY title COLLATE NOCASE ASC`,
  );
  return rows.map(rowToLabel);
}

export async function listLabelsForTask(taskLocalId: string): Promise<Label[]> {
  const db = await getDb();
  const rows = await db.select<LabelRow[]>(
    `SELECT ${SELECT_COLS.split(', ')
      .map((c) => `l.${c}`)
      .join(', ')}
       FROM labels l
       JOIN task_labels tl ON tl.label_local_id = l.local_id
      WHERE tl.task_local_id = ?
        AND tl.deleted = 0
        AND l.deleted = 0
   ORDER BY l.title COLLATE NOCASE ASC`,
    [taskLocalId],
  );
  return rows.map(rowToLabel);
}

async function localIdForServerId(serverId: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ local_id: string }[]>(
    `SELECT local_id FROM labels WHERE server_id = ? LIMIT 1`,
    [serverId],
  );
  return rows[0]?.local_id ?? null;
}

/**
 * Upsert a label payload from the server (keyed by server_id). Sync-path
 * upsert — does not call `notify()` (see the matching note in
 * src/db/projects.ts).
 */
export async function upsertLabelFromServer(
  payload: LabelResponse,
): Promise<string> {
  const serverId = payload.id;
  const existing = await localIdForServerId(serverId);
  const localId = existing ?? nanoid();
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;

  if (existing) {
    await exec(
      `UPDATE labels SET
         title       = ?,
         description = ?,
         hex_color   = ?,
         updated_at  = ?,
         synced_at   = ?,
         last_synced = ?,
         dirty       = 0,
         deleted     = 0
       WHERE local_id = ?`,
      [
        payload.title,
        payload.description ?? null,
        payload.hex_color ?? null,
        updatedAt,
        now,
        JSON.stringify(payload),
        localId,
      ],
    );
  } else {
    await exec(
      `INSERT INTO labels (
         local_id, server_id, title, description, hex_color,
         updated_at, synced_at, last_synced, dirty, deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        localId,
        serverId,
        payload.title,
        payload.description ?? null,
        payload.hex_color ?? null,
        updatedAt,
        now,
        JSON.stringify(payload),
      ],
    );
  }
  return localId;
}

/**
 * Replace the set of labels attached to a task with the given set
 * (identified by their server IDs). Inserts any labels we haven't seen
 * yet using the supplied payloads, then mirrors the join table.
 *
 * Used by the pull loop: each task payload from Vikunja embeds its
 * full label list. We treat the server's view as authoritative for the
 * link set — local mutations on labels aren't supported yet (M5+).
 */
export async function replaceTaskLabelsFromServer(
  taskLocalId: string,
  labels: LabelResponse[],
): Promise<void> {
  const now = new Date().toISOString();
  const labelLocalIds: string[] = [];
  for (const payload of labels) {
    const id = await upsertLabelFromServer(payload);
    labelLocalIds.push(id);
  }

  // Wipe the existing links, then insert the new set. Cheap because the
  // typical task has < 10 labels.
  await exec(`DELETE FROM task_labels WHERE task_local_id = ?`, [
    taskLocalId,
  ]);
  for (const labelLocalId of labelLocalIds) {
    await exec(
      `INSERT INTO task_labels
         (task_local_id, label_local_id, updated_at, synced_at, dirty, deleted)
       VALUES (?, ?, ?, ?, 0, 0)`,
      [taskLocalId, labelLocalId, now, now],
    );
  }
}

/**
 * Toggle a label on/off for a task. User-mutation path — sets dirty=1 and
 * notifies. Creates an outbox entry so the push layer can sync the change.
 */
export async function toggleTaskLabel(
  taskLocalId: string,
  labelLocalId: string,
): Promise<boolean> {
  const db = await getDb();
  const now = new Date().toISOString();

  const existing = await db.select<{ deleted: number }[]>(
    `SELECT deleted FROM task_labels WHERE task_local_id = ? AND label_local_id = ? LIMIT 1`,
    [taskLocalId, labelLocalId],
  );

  if (existing.length === 0) {
    await withTx(async (tx) => {
      await tx.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted)
         VALUES (?, ?, ?, 1, 0)`,
        [taskLocalId, labelLocalId, now],
      );
      await tx.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('task_label', ?, 'add', ?, ?)`,
        [taskLocalId, JSON.stringify({ labelLocalId }), now],
      );
    });
    notify('task_labels');
    notify('outbox');
    return true;
  }

  const existingRow = existing[0];
  if (!existingRow) return false;
  const wasDeleted = existingRow.deleted === 1;
  if (wasDeleted) {
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE task_labels SET deleted = 0, dirty = 1, updated_at = ? WHERE task_local_id = ? AND label_local_id = ?`,
        [now, taskLocalId, labelLocalId],
      );
      await tx.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('task_label', ?, 'add', ?, ?)`,
        [taskLocalId, JSON.stringify({ labelLocalId }), now],
      );
    });
    notify('task_labels');
    notify('outbox');
    return true;
  }

  await withTx(async (tx) => {
    await tx.execute(
      `UPDATE task_labels SET deleted = 1, dirty = 1, updated_at = ? WHERE task_local_id = ? AND label_local_id = ?`,
      [now, taskLocalId, labelLocalId],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task_label', ?, 'remove', ?, ?)`,
      [taskLocalId, JSON.stringify({ labelLocalId }), now],
    );
  });
  notify('task_labels');
  notify('outbox');
  return false;
}
