import { nanoid } from 'nanoid';
import { getDb, withTx } from './index';
import { mergeFromServer } from './syncMerge';
import {
  normaliseDate,
  type Task,
  type TaskResponse,
  type TaskInput,
  type TaskUpdate,
} from '@/domain/task';
import { notify } from './bus';

interface TaskRow {
  local_id: string;
  server_id: number | null;
  identifier: string | null;
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
  is_favorite: number;
  is_subscribed: number;
  repeat_after: number;
  repeat_mode: number;
  updated_at: string;
  created_at: string | null;
  created_by_id: number | null;
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
    percentDone: row.percent_done <= 1
      ? Math.round(row.percent_done * 100)
      : Math.round(row.percent_done),
    hexColor: row.hex_color ? (row.hex_color.startsWith('#') ? row.hex_color : `#${row.hex_color}`) : null,
    position: row.position,
    isFavorite: row.is_favorite === 1,
    isSubscribed: row.is_subscribed === 1,
    repeatAfter: row.repeat_after,
    repeatMode: row.repeat_mode,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    createdById: row.created_by_id,
    identifier: row.identifier,
  };
}

const SELECT_TASK_COLS = `
  local_id, server_id, project_local_id, title, description, done, done_at,
  due_date, start_date, end_date, priority, percent_done, hex_color,
  position, is_favorite, is_subscribed, repeat_after, repeat_mode,
  updated_at, created_at, created_by_id, identifier`;

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

/* ───────────────────────── cross-project reads (M6 smart views) ────── */

/** A task plus its owning project's title, for grouped views where the
 * project context isn't implicit (Today / Upcoming / Label). */
export interface TaskWithProject extends Task {
  projectTitle: string;
}

interface TaskWithProjectRow extends TaskRow {
  project_title: string;
}

// SELECT_TASK_COLS prefixed with the `t.` table alias for joins; SQLite
// returns each as its bare column name, so it still maps to TaskRow.
const SELECT_TASK_COLS_T = SELECT_TASK_COLS.split(',')
  .map((c) => `t.${c.trim()}`)
  .join(', ');

function rowToTaskWithProject(row: TaskWithProjectRow): TaskWithProject {
  return { ...rowToTask(row), projectTitle: row.project_title };
}

/**
 * Every incomplete, non-deleted task that has a due date, across all
 * projects, with its project title. The Today/Upcoming bucketing
 * (overdue / today / next-7-days) is done in the query layer to avoid
 * SQLite timezone arithmetic on the ISO `due_date` strings.
 */
export async function listTasksWithDueDate(): Promise<TaskWithProject[]> {
  const db = await getDb();
  const rows = await db.select<TaskWithProjectRow[]>(
    `SELECT ${SELECT_TASK_COLS_T}, p.title AS project_title
       FROM tasks t
       JOIN projects p ON p.local_id = t.project_local_id
      WHERE t.deleted = 0 AND t.done = 0 AND t.due_date IS NOT NULL
        AND p.deleted = 0
   ORDER BY t.due_date ASC, t.priority DESC`,
  );
  return rows.map(rowToTaskWithProject);
}

/** All non-deleted, non-done favorited tasks, with project title,
 * for the Favorites smart view. */
export async function listFavoriteTasks(): Promise<TaskWithProject[]> {
  const db = await getDb();
  const rows = await db.select<TaskWithProjectRow[]>(
    `SELECT ${SELECT_TASK_COLS_T}, p.title AS project_title
       FROM tasks t
       JOIN projects p ON p.local_id = t.project_local_id
      WHERE t.deleted = 0 AND t.done = 0 AND t.is_favorite = 1
        AND p.deleted = 0
   ORDER BY t.due_date IS NULL, t.due_date ASC, t.priority DESC`,
  );
  return rows.map(rowToTaskWithProject);
}

/** All non-deleted tasks carrying the given label, with project title,
 * for the per-label smart view (grouped by project in the UI). */
export async function listTasksForLabel(
  labelLocalId: string,
): Promise<TaskWithProject[]> {
  const db = await getDb();
  const rows = await db.select<TaskWithProjectRow[]>(
    `SELECT ${SELECT_TASK_COLS_T}, p.title AS project_title
       FROM tasks t
       JOIN task_labels tl ON tl.task_local_id = t.local_id
       JOIN projects p ON p.local_id = t.project_local_id
      WHERE tl.label_local_id = ? AND tl.deleted = 0
        AND t.deleted = 0 AND p.deleted = 0
   ORDER BY t.done ASC, t.due_date IS NULL, t.due_date ASC,
            t.title COLLATE NOCASE ASC`,
    [labelLocalId],
  );
  return rows.map(rowToTaskWithProject);
}

export interface SearchFilters {
  text: string;
  dueDateStart?: string | null;
  dueDateEnd?: string | null;
  labelTitle?: string | null;
  priority?: number | null;
}

/**
 * Full-text search across all non-deleted tasks using FTS5, with optional
 * structured filters (date range, label, priority). When `text` is empty
 * FTS5 MATCH is skipped, so a pure filter query (e.g. "due today") returns
 * all tasks matching the filters without a text constraint.
 */
export async function searchTasks(filters: SearchFilters): Promise<TaskWithProject[]> {
  const sanitized = filters.text
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim();

  const conditions: string[] = [
    't.deleted = 0',
    'p.deleted = 0',
  ];
  const params: unknown[] = [];

  if (sanitized) {
    const ftsQuery = sanitized
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w}*`)
      .join(' AND ');
    conditions.push('tasks_fts MATCH ?');
    params.push(ftsQuery);
  }

  if (filters.dueDateStart) {
    conditions.push('t.due_date >= ?');
    params.push(filters.dueDateStart);
  }
  if (filters.dueDateEnd) {
    conditions.push('t.due_date <= ?');
    params.push(filters.dueDateEnd);
  }
  if (filters.priority != null) {
    conditions.push('t.priority = ?');
    params.push(filters.priority);
  }
  if (filters.labelTitle) {
    conditions.push(`t.local_id IN (
      SELECT tl.task_local_id FROM task_labels tl
      JOIN labels l ON l.local_id = tl.label_local_id
      WHERE l.title = ? AND tl.deleted = 0
    )`);
    params.push(filters.labelTitle);
  }

  const fromClause = sanitized
    ? 'tasks_fts fts JOIN tasks t ON t.rowid = fts.rowid JOIN projects p ON p.local_id = t.project_local_id'
    : 'tasks t JOIN projects p ON p.local_id = t.project_local_id';

  const orderBy = sanitized ? 'rank' : 't.due_date ASC, t.priority DESC';

  const db = await getDb();
  const rows = await db.select<TaskWithProjectRow[]>(
    `SELECT ${sanitized ? SELECT_TASK_COLS_T : SELECT_TASK_COLS_T}, p.title AS project_title
       FROM ${fromClause}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT 50`,
    params,
  );
  return rows.map(rowToTaskWithProject);
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

const TASK_CONFLICT_FIELDS = [
  'title',
  'description',
  'done',
  'due_date',
  'start_date',
  'end_date',
  'priority',
  'percent_done',
  'hex_color',
  'position',
] as const;

/**
 * Upsert a task payload that came from the server. Lookup by server_id;
 * resolves project_id → project_local_id from the local DB (the project
 * must already be synced — pullTasksForProject() guarantees this).
 *
 * Tasks whose project isn't yet synced are skipped (returns null) and a
 * warning is logged. The next pull pass picks them up.
 *
 * Dirty-guard + conflict detection are delegated to mergeFromServer.
 * Pending local deletes (dirty=1 && deleted=1) are a *subset* of dirty=1,
 * so the helper's "skip-on-dirty" branch covers them — no special case
 * needed here.
 */
export async function upsertTaskFromServer(
  payload: TaskResponse,
): Promise<string | null> {
  // Per-entity resolution: project_id → project_local_id. Must run before
  // the helper because the INSERT/UPDATE column lists embed the FK.
  const projectLocalId = await projectLocalIdForServerId(payload.project_id);
  if (!projectLocalId) {
    console.warn(
      `[db/tasks] skipping task ${payload.id}: project ${payload.project_id} not synced`,
    );
    return null;
  }

  const serverId = payload.id;
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;

  // Column values shared by INSERT and UPDATE. last_synced is appended
  // separately by each callback because the helper injects the stringified
  // remote payload as the `lastSyncedJson` argument.
  const colParams = [
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
    payload.is_favorite === true ? 1 : 0,
    (payload as any).subscription != null ? 1 : 0,
    payload.repeat_after ?? 0,
    payload.repeat_mode ?? 0,
    payload.identifier ?? null,
    updatedAt,
    now,
    payload.created ?? null,
    payload.created_by?.id ?? null,
  ];

  return mergeFromServer({
    entity: 'task',
    serverId,
    remotePayload: payload as unknown as Record<string, unknown>,
    conflictFields: TASK_CONFLICT_FIELDS,
    insert: (localId, lastSyncedJson) => ({
      sql: `INSERT INTO tasks (
              local_id, server_id, project_local_id, title, description, done,
              done_at, due_date, start_date, end_date, priority, percent_done,
              hex_color, position, is_favorite, is_subscribed, repeat_after,
              repeat_mode, identifier, updated_at, synced_at,
              created_at, created_by_id, last_synced,
              dirty, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      params: [localId, serverId, ...colParams, lastSyncedJson],
    }),
    update: (localId, lastSyncedJson) => ({
      sql: `UPDATE tasks SET
              project_local_id = ?,
              title            = ?,
              description      = ?,
              done             = ?,
              done_at           = ?,
              due_date          = ?,
              start_date        = ?,
              end_date          = ?,
              priority          = ?,
              percent_done      = ?,
              hex_color         = ?,
              position          = ?,
              is_favorite       = ?,
              is_subscribed     = ?,
              repeat_after      = ?,
              repeat_mode       = ?,
              identifier        = ?,
              updated_at        = ?,
              synced_at         = ?,
              created_at        = ?,
              created_by_id     = ?,
              last_synced       = ?,
              dirty             = 0,
              deleted           = 0
            WHERE local_id = ? AND deleted = 0 AND dirty = 0`,
      params: [...colParams, lastSyncedJson, localId],
    }),
  });
  // Intentionally no notify() — see the matching note in src/db/projects.ts.
}

export async function createTask(input: TaskInput): Promise<Task> {
  const localId = nanoid();
  const now = new Date().toISOString();

  // withTx now batches writes — they execute together after the
  // callback resolves. The post-write SELECT must therefore live
  // *outside* the callback.
  await withTx(async (db) => {
    await db.execute(
      `INSERT INTO tasks (
         local_id, server_id, project_local_id, title, description, done,
         done_at, due_date, start_date, end_date, priority, percent_done,
         hex_color, position, is_favorite, is_subscribed, repeat_after,
         repeat_mode, identifier, updated_at, created_at, dirty, deleted
       ) VALUES (?, NULL, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, 1, 0)`,
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
        input.isFavorite === true ? 1 : 0,
        input.repeatAfter ?? 0,
        input.repeatMode ?? 0,
        now,
        now,
      ]
    );

    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'create', ?, ?)`,
      [localId, JSON.stringify(input), now]
    );
  });

  notify('tasks');
  notify('outbox');

  const created = await getTaskByLocalId(localId);
  if (!created) {
    throw new Error(`Failed to retrieve newly created task ${localId}`);
  }
  return created;
}

export async function updateTask(
  localId: string,
  input: TaskUpdate,
): Promise<Task> {
  const now = new Date().toISOString();

  // Pre-write read is safe outside withTx because the serial queue
  // ensures no other write interleaves between this select and the
  // batched writes below.
  const current = await getTaskByLocalId(localId);
  if (!current) {
    throw new Error(`Task not found: ${localId}`);
  }

  await withTx(async (db) => {
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
    if (input.isFavorite !== undefined) {
      sets.push('is_favorite = ?');
      params.push(input.isFavorite ? 1 : 0);
    }
    if (input.isSubscribed !== undefined) {
      sets.push('is_subscribed = ?');
      params.push(input.isSubscribed ? 1 : 0);
    }
    if (input.repeatAfter !== undefined) {
      sets.push('repeat_after = ?');
      params.push(input.repeatAfter);
    }
    if (input.repeatMode !== undefined) {
      sets.push('repeat_mode = ?');
      params.push(input.repeatMode);
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
  });

  notify('tasks');
  notify('outbox');

  const updated = await getTaskByLocalId(localId);
  if (!updated) {
    throw new Error(`Failed to retrieve updated task ${localId}`);
  }
  return updated;
}

export async function duplicateTask(localId: string): Promise<Task | null> {
  const original = await getTaskByLocalId(localId);
  if (!original) return null;
  return createTask({
    title: original.title,
    projectLocalId: original.projectLocalId,
    description: original.description,
    dueDate: original.dueDate,
    startDate: original.startDate,
    endDate: original.endDate,
    priority: original.priority,
    percentDone: original.percentDone,
    hexColor: original.hexColor,
  });
}

export async function moveTask(
  localId: string,
  newProjectLocalId: string,
): Promise<Task> {
  const now = new Date().toISOString();

  await withTx(async (db) => {
    await db.execute(
      `UPDATE tasks SET project_local_id = ?, updated_at = ?, dirty = 1 WHERE local_id = ?`,
      [newProjectLocalId, now, localId],
    );

    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'update', ?, ?)`,
      [localId, JSON.stringify({ projectLocalId: newProjectLocalId }), now],
    );
  });

  notify('tasks');
  notify('outbox');

  const updated = await getTaskByLocalId(localId);
  if (!updated) {
    throw new Error(`Failed to retrieve moved task ${localId}`);
  }
  return updated;
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

export async function listActiveTaskCounts(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.select<{ project_local_id: string; cnt: number }[]>(
    `SELECT project_local_id, COUNT(*) as cnt
     FROM tasks
     WHERE deleted = 0 AND done = 0
     GROUP BY project_local_id`,
  );
  return new Map(rows.map((r) => [r.project_local_id, r.cnt]));
}
