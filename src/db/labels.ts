import { nanoid } from 'nanoid';
import { getDb, exec, withTx } from './index';
import { mergeFromServer } from './syncMerge';
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
    hexColor: row.hex_color ? (row.hex_color.startsWith('#') ? row.hex_color : `#${row.hex_color}`) : null,
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

/**
 * Map of `task_local_id → label_local_id[]` for every task in a project.
 * Lets the kanban filter match tasks by label without a per-task query.
 */
export async function listTaskLabelLinksForProject(
  projectLocalId: string,
): Promise<Map<string, string[]>> {
  const db = await getDb();
  const rows = await db.select<{ task_local_id: string; label_local_id: string }[]>(
    `SELECT tl.task_local_id, tl.label_local_id
       FROM task_labels tl
       JOIN tasks t ON t.local_id = tl.task_local_id
      WHERE t.project_local_id = ?
        AND tl.deleted = 0
        AND t.deleted = 0`,
    [projectLocalId],
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const arr = map.get(r.task_local_id) ?? [];
    arr.push(r.label_local_id);
    map.set(r.task_local_id, arr);
  }
  return map;
}

/**
 * Upsert a label payload from the server (keyed by server_id). Sync-path
 * upsert — does not call `notify()` (see the matching note in
 * src/db/projects.ts).
 *
 * Dirty-guard + conflict detection delegated to mergeFromServer.
 */
export async function upsertLabelFromServer(
  payload: LabelResponse,
): Promise<string> {
  const serverId = payload.id;
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;

  return mergeFromServer({
    entity: 'label',
    serverId,
    remotePayload: payload as unknown as Record<string, unknown>,
    insert: (localId, lastSyncedJson) => ({
      sql: `INSERT INTO labels (
              local_id, server_id, title, description, hex_color,
              updated_at, synced_at, last_synced, dirty, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      params: [
        localId,
        serverId,
        payload.title,
        payload.description ?? null,
        payload.hex_color ?? null,
        updatedAt,
        now,
        lastSyncedJson,
      ],
    }),
    update: (localId, lastSyncedJson) => ({
      sql: `UPDATE labels SET
              title       = ?,
              description = ?,
              hex_color   = ?,
              updated_at  = ?,
              synced_at   = ?,
              last_synced = ?,
              dirty       = 0,
              deleted     = 0
            WHERE local_id = ? AND deleted = 0 AND dirty = 0`,
      params: [
        payload.title,
        payload.description ?? null,
        payload.hex_color ?? null,
        updatedAt,
        now,
        lastSyncedJson,
        localId,
      ],
    }),
  });
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

/* ───────────────────────── user mutations on labels themselves ─────── */

export interface LabelInput {
  title: string;
  description?: string | null;
  hexColor?: string | null;
}

export type LabelUpdate = Partial<LabelInput>;

export async function getLabelByLocalId(localId: string): Promise<Label | null> {
  const db = await getDb();
  const rows = await db.select<LabelRow[]>(
    `SELECT ${SELECT_COLS} FROM labels WHERE local_id = ? AND deleted = 0 LIMIT 1`,
    [localId],
  );
  const row = rows[0];
  return row ? rowToLabel(row) : null;
}

export async function createLabel(input: LabelInput): Promise<Label> {
  const localId = nanoid();
  const now = new Date().toISOString();
  await withTx(async (db) => {
    await db.execute(
      `INSERT INTO labels (
         local_id, server_id, title, description, hex_color,
         updated_at, dirty, deleted
       ) VALUES (?, NULL, ?, ?, ?, ?, 1, 0)`,
      [
        localId,
        input.title,
        input.description ?? null,
        input.hexColor ?? null,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('label', ?, 'create', ?, ?)`,
      [localId, JSON.stringify(input), now],
    );
  });
  notify('labels');
  notify('outbox');
  const created = await getLabelByLocalId(localId);
  if (!created) throw new Error(`Failed to retrieve newly created label ${localId}`);
  return created;
}

/**
 * Apply a set of label *titles* to a task. Existing labels match
 * case-insensitively; a title with no match is created on the fly and
 * then applied. Used by the quick-add entry points so `Buy milk
 * #newlabel` both creates the label and tags the task — matching the
 * detail-card "Create label" flow.
 *
 * Titles are de-duplicated case-insensitively first so a repeated
 * `#tag #tag` doesn't toggle the label off again (toggleTaskLabel
 * flips state). Throws on the first failure; callers wrap in try/catch
 * so a bad label never fails the surrounding task creation.
 */
export async function applyLabelsByTitle(
  taskLocalId: string,
  titles: string[],
): Promise<void> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of titles) {
    const title = raw.trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(title);
  }
  if (ordered.length === 0) return;

  const all = await listLabels();
  const lookup = new Map(all.map((l) => [l.title.toLowerCase(), l.localId]));
  for (const title of ordered) {
    let id = lookup.get(title.toLowerCase());
    if (!id) {
      const label = await createLabel({ title });
      id = label.localId;
      lookup.set(title.toLowerCase(), id);
    }
    await toggleTaskLabel(taskLocalId, id);
  }
}

export async function updateLabel(localId: string, input: LabelUpdate): Promise<Label> {
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.title !== undefined) {
    sets.push('title = ?');
    params.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push('description = ?');
    params.push(input.description);
  }
  if (input.hexColor !== undefined) {
    sets.push('hex_color = ?');
    params.push(input.hexColor);
  }
  if (sets.length === 0) {
    const cur = await getLabelByLocalId(localId);
    if (!cur) throw new Error(`Label not found: ${localId}`);
    return cur;
  }
  sets.push('updated_at = ?');
  params.push(now);
  sets.push('dirty = 1');
  params.push(localId);

  await withTx(async (db) => {
    await db.execute(`UPDATE labels SET ${sets.join(', ')} WHERE local_id = ?`, params);
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('label', ?, 'update', ?, ?)`,
      [localId, JSON.stringify(input), now],
    );
  });
  notify('labels');
  notify('outbox');
  const updated = await getLabelByLocalId(localId);
  if (!updated) throw new Error(`Failed to retrieve updated label ${localId}`);
  return updated;
}

export async function deleteLabel(localId: string): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (db) => {
    const rows = await db.select<{ local_id: string }[]>(
      `SELECT local_id FROM labels WHERE local_id = ? AND deleted = 0 LIMIT 1`,
      [localId],
    );
    if (rows.length === 0) return;
    // Soft-delete the label and remove every task_label link locally so
    // the chips disappear immediately. The server-side DELETE cascades
    // the join rows; the next pull confirms.
    await db.execute(
      `UPDATE labels SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?`,
      [now, localId],
    );
    await db.execute(
      `DELETE FROM task_labels WHERE label_local_id = ?`,
      [localId],
    );
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('label', ?, 'delete', '{}', ?)`,
      [localId, now],
    );
  });
  notify('labels');
  notify('tasks');
  notify('task_labels');
  notify('outbox');
}
