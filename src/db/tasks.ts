import { nanoid } from 'nanoid';
import { getDb, withTx } from './index';
import { normaliseDate, type Task, type TaskResponse, type TaskInput, type TaskUpdate } from '@/domain/task';
import { notify } from './bus';

interface TaskRow {
  local_id: string;
  server_id: number | null;
  project_local_id: string;
  title: string;
  description: string | null;
  done: number;
  done_at: string | null;
  due_date: string | null;
  start_date: string | null;
  end_date: string | null;
  priority: number;
  percent_done: number;
  hex_color: string | null;
  position: number | null;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    localId: row.local_id,
    serverId: row.server_id,
    projectLocalId: row.project_local_id,
    title: row.title,
    description: row.description,
    done: row.done === 1,
    doneAt: row.done_at,
    dueDate: row.due_date,
    startDate: row.start_date,
    endDate: row.end_date,
    priority: row.priority,
    percentDone: row.percent_done,
    hexColor: row.hex_color,
    position: row.position,
    updatedAt: row.updated_at,
  };
}

const SELECT_TASK_COLS = `
  local_id, server_id, project_local_id, title, description, done, done_at,
  due_date, start_date, end_date, priority, percent_done, hex_color,
  position, updated_at`;

export async function listTasksForProject(
  projectLocalId: string,
): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.select<TaskRow[]>(
    `SELECT ${SELECT_TASK_COLS}
       FROM tasks
      WHERE project_local_id = ?
        AND deleted = 0
   ORDER BY done ASC,
            position IS NULL,
            position ASC,
            due_date IS NULL,
            due_date ASC,
            title COLLATE NOCASE ASC`,
    [projectLocalId],
  );
  return rows.map(rowToTask);
}

export async function getTaskByLocalId(localId: string): Promise<Task | null> {
  const db = await getDb();
  const rows = await db.select<TaskRow[]>(
    `SELECT ${SELECT_TASK_COLS}
       FROM tasks
      WHERE local_id = ?
        AND deleted = 0
      LIMIT 1`,
    [localId],
  );
  const row = rows[0];
  return row ? rowToTask(row) : null;
}

interface ProjectLookup {
  local_id: string;
}

async function projectLocalIdForServerId(
  serverId: number,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<ProjectLookup[]>(
    `SELECT local_id FROM projects WHERE server_id = ? LIMIT 1`,
    [serverId],
  );
  return rows[0]?.local_id ?? null;
}

interface TaskLookup {
  local_id: string;
}

async function localIdForServerId(serverId: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<TaskLookup[]>(
    `SELECT local_id FROM tasks WHERE server_id = ? LIMIT 1`,
    [serverId],
  );
  return rows[0]?.local_id ?? null;
}

/**
 * Upsert a task payload that came from the server. Lookup by server_id;
 * resolves project_id → project_local_id from the local DB (the project
 * must already be synced — pullTasksForProject() guarantees this).
 *
 * Tasks whose project isn't yet synced are skipped (returns null) and a
 * warning is logged. The next pull pass picks them up.
 */
export async function upsertTaskFromServer(
  payload: TaskResponse,
): Promise<string | null> {
  const projectLocalId = await projectLocalIdForServerId(payload.project_id);
  if (!projectLocalId) {
    console.warn(
      `[db/tasks] skipping task ${payload.id}: project ${payload.project_id} not synced`,
    );
    return null;
  }

  const serverId = payload.id;
  const existing = await localIdForServerId(serverId);
  const localId = existing ?? nanoid();
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;

  const params = [
    projectLocalId,
    payload.title,
    payload.description ?? null,
    payload.done === true ? 1 : 0,
    normaliseDate(payload.done_at),
    normaliseDate(payload.due_date),
    normaliseDate(payload.start_date),
    normaliseDate(payload.end_date),
    payload.priority ?? 0,
    payload.percent_done ?? 0,
    payload.hex_color ?? null,
    payload.position ?? null,
    updatedAt,
    now,
    JSON.stringify(payload),
  ];

  const db = await getDb();
  if (existing) {
    // Conflict detection: if local row is dirty, compare snapshots
    const localRows = await db.select<any[]>(`SELECT * FROM tasks WHERE local_id = ?`, [localId]);
    const localRow = localRows[0];
    if (localRow && localRow.dirty === 1) {
      const remoteSnap = JSON.stringify(payload);
      const localSnap = localRow.last_synced ?? '';
      if (localSnap && localSnap !== remoteSnap) {
        // Determine differing fields (basic comparison)
        const compareFields = [
          'title', 'description', 'done', 'due_date', 'start_date', 'end_date',
          'priority', 'percent_done', 'hex_color', 'position',
        ];
        const remoteObj: any = payload;
        const localObj: any = JSON.parse(localSnap);
        const fields: string[] = [];
        for (const f of compareFields) {
          const rv = (remoteObj as any)[f];
          const lv = (localObj as any)[f];
          if (rv !== undefined && rv !== lv) {
            fields.push(f);
          }
        }
        const now = new Date().toISOString();
        await db.execute(
          `INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at) VALUES (?, ?, ?, ?, ?, ?)`,
          ['task', localId, JSON.stringify(fields), localSnap, remoteSnap, now],
        );
        // Skip automatic update; keep dirty flag for user resolution
      } else {
        // No conflict, proceed with normal update
        await db.execute(
          `UPDATE tasks SET
             project_local_id = ?,
             title            = ?,
             description      = ?,
             done             = ?,
             done_at          = ?,
             due_date         = ?,
             start_date       = ?,
             end_date         = ?,
             priority         = ?,
             percent_done     = ?,
             hex_color        = ?,
             position         = ?,
             updated_at       = ?,
             synced_at        = ?,
             last_synced      = ?,
             dirty            = 0,
             deleted          = 0
           WHERE local_id = ?`,
          [...params, localId],
        );
      }
    } else {
      // Not dirty, safe to update
      await db.execute(
        `UPDATE tasks SET
           project_local_id = ?,
           title            = ?,
           description      = ?,
           done             = ?,
           done_at          = ?,
           due_date         = ?,
           start_date       = ?,
           end_date         = ?,
           priority         = ?,
           percent_done     = ?,
           hex_color        = ?,
           position         = ?,
           updated_at       = ?,
           synced_at        = ?,
           last_synced      = ?,
           dirty            = 0,
           deleted          = 0
         WHERE local_id = ?`,
        [...params, localId],
      );
    }
  } else {
    await db.execute(
      `INSERT INTO tasks (
         local_id, server_id, project_local_id, title, description, done,
         done_at, due_date, start_date, end_date, priority, percent_done,
         hex_color, position, updated_at, synced_at, last_synced,
         dirty, deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [localId, serverId, ...params],
    );
  }

  // Intentionally no notify() — see the matching note in src/db/projects.ts.
  return localId;
}

export async function createTask(input: TaskInput): Promise<Task> {
  const localId = nanoid();
  const now = new Date().toISOString();

  const task = await withTx(async (db) => {
    await db.execute(
      `INSERT INTO tasks (
         local_id, server_id, project_local_id, title, description, done,
         done_at, due_date, start_date, end_date, priority, percent_done,
         hex_color, position, updated_at, dirty, deleted
       ) VALUES (?, NULL, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        localId,
        input.projectLocalId,
        input.title,
        input.description ?? null,
        input.dueDate ?? null,
        input.startDate ?? null,
        input.endDate ?? null,
        input.priority ?? 0,
        input.percentDone ?? 0,
        input.hexColor ?? null,
        null,
        now,
      ]
    );

    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'create', ?, ?)`,
      [localId, JSON.stringify(input), now]
    );

    const created = await getTaskByLocalId(localId);
    if (!created) {
      throw new Error(`Failed to retrieve newly created task ${localId}`);
    }
    return created;
  });

  notify('tasks');
  notify('outbox');
  return task;
}

export async function updateTask(
  localId: string,
  input: TaskUpdate,
): Promise<Task> {
  const now = new Date().toISOString();

  const task = await withTx(async (db) => {
    const current = await getTaskByLocalId(localId);
    if (!current) {
      throw new Error(`Task not found: ${localId}`);
    }

    const sets: string[] = [];
    const params: any[] = [];

    if (input.title !== undefined) {
      sets.push('title = ?');
      params.push(input.title);
    }
    if (input.description !== undefined) {
      sets.push('description = ?');
      params.push(input.description);
    }
    if (input.done !== undefined) {
      sets.push('done = ?');
      params.push(input.done ? 1 : 0);
      sets.push('done_at = ?');
      params.push(input.done ? now : null);
    }
    if (input.dueDate !== undefined) {
      sets.push('due_date = ?');
      params.push(input.dueDate);
    }
    if (input.startDate !== undefined) {
      sets.push('start_date = ?');
      params.push(input.startDate);
    }
    if (input.endDate !== undefined) {
      sets.push('end_date = ?');
      params.push(input.endDate);
    }
    if (input.priority !== undefined) {
      sets.push('priority = ?');
      params.push(input.priority);
    }
    if (input.percentDone !== undefined) {
      sets.push('percent_done = ?');
      params.push(input.percentDone);
    }
    if (input.hexColor !== undefined) {
      sets.push('hex_color = ?');
      params.push(input.hexColor);
    }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      params.push(now);
      sets.push('dirty = 1');

      params.push(localId);

      await db.execute(
        `UPDATE tasks SET ${sets.join(', ')} WHERE local_id = ?`,
        params,
      );

      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('task', ?, 'update', ?, ?)`,
        [localId, JSON.stringify(input), now]
      );
    }

    const updated = await getTaskByLocalId(localId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated task ${localId}`);
    }
    return updated;
  });

  notify('tasks');
  notify('outbox');
  return task;
}

export async function deleteTask(localId: string): Promise<void> {
  const now = new Date().toISOString();

  await withTx(async (db) => {
    const current = await db.select<TaskRow[]>(
      `SELECT local_id FROM tasks WHERE local_id = ? AND deleted = 0 LIMIT 1`,
      [localId],
    );
    if (current.length === 0) {
      return;
    }

    await db.execute(
      `UPDATE tasks SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?`,
      [now, localId]
    );

    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'delete', '{}', ?)`,
      [localId, now]
    );
  });

  notify('tasks');
  notify('outbox');
}
