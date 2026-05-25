import { nanoid } from 'nanoid';
import { getDb } from './index';
import { normaliseDate, type Task, type TaskResponse } from '@/domain/task';

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
