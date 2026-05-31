/**
 * Local mirror + mutation queue for task relations.
 *
 * Vikunja stores a task's relations as a map keyed by RelationKind
 * whose values are arrays of Task. We flatten that into rows in
 * `task_relations` and join back on read.
 *
 * The other side of a relation may not be locally synced yet — common
 * when the user lives in one project and the related task is in
 * another that hasn't been opened since the last full pull. We carry
 * `other_task_server_id` so we can still render and refer to the
 * relation; once the local task arrives, the next pull re-resolves
 * the row via `replaceTaskRelationsFromServer`.
 *
 * Push: add/remove queue a `task_relation` outbox op. push.ts hits the
 * `/tasks/{taskID}/relations` endpoints to mutate server-side; the
 * server creates the inverse on the other task automatically, so we
 * don't push it ourselves.
 */
import { getDb, withTx } from './index';
import { notify } from './bus';
import {
  inverseRelationKind,
  type RelatedTaskResponse,
  type TaskRelationKind,
} from '@/domain/task';

export interface TaskRelation {
  kind: TaskRelationKind;
  otherTaskLocalId: string | null;
  otherTaskServerId: number | null;
  otherTaskTitle: string;
  otherTaskDone: boolean;
  /** Project id on the *other* task — for cross-project relations the
   * detail card can hint at where the relation points. */
  otherTaskProjectServerId: number | null;
  createdAt: string | null;
}

interface RelationRow {
  relation_kind: string;
  other_task_local_id: string | null;
  other_task_server_id: number | null;
  /** Joined from `tasks` when other side is local. */
  other_title: string | null;
  other_done: number | null;
  other_project_server_id: number | null;
  created_at: string | null;
}

/**
 * Replace this task's mirrored relations with the server's set.
 *
 * Skipped when the owning task is `dirty` — same pattern reminders use
 * (see src/db/reminders.ts) to avoid resurrecting a relation the user
 * just removed locally before the outbox push lands.
 */
export async function replaceTaskRelationsFromServer(
  taskLocalId: string,
  related: Record<string, RelatedTaskResponse[]>,
): Promise<void> {
  await withTx(async (tx) => {
    const [{ dirty } = { dirty: 0 }] = await tx.select<{ dirty: number }[]>(
      `SELECT dirty FROM tasks WHERE local_id = ? LIMIT 1`,
      [taskLocalId],
    );
    if (dirty === 1) return;

    // Relations the user added/removed locally but hasn't pushed yet must
    // survive a server pull — the server doesn't know about them, so a blind
    // delete-and-reinsert would wipe the optimistic relation (incl. the
    // auto-created inverse on the peer task). The outbox is the source of truth
    // for "pending". An op can touch this task as the owner (forward kind) or
    // as the peer (the inverse kind). See issue #87.
    const ops = await tx.select<{ entity_local_id: string; op: string; payload: string }[]>(
      `SELECT entity_local_id, op, payload FROM outbox
        WHERE entity_type = 'task_relation' ORDER BY id ASC`,
    );
    const preserve = new Map<string, { other: string; kind: TaskRelationKind }>();
    const exclude = new Set<string>();
    for (const o of ops) {
      let payload: { otherTaskLocalId?: string | null; kind?: TaskRelationKind };
      try {
        payload = JSON.parse(o.payload);
      } catch {
        continue;
      }
      if (!payload.kind) continue;
      let other: string | null = null;
      let kind: TaskRelationKind | null = null;
      if (o.entity_local_id === taskLocalId) {
        other = payload.otherTaskLocalId ?? null;
        kind = payload.kind;
      } else if (payload.otherTaskLocalId === taskLocalId) {
        other = o.entity_local_id;
        kind = inverseRelationKind(payload.kind);
      }
      if (!other || !kind) continue;
      const key = `${other}|${kind}`;
      if (o.op === 'add') {
        preserve.set(key, { other, kind });
        exclude.delete(key);
      } else if (o.op === 'remove') {
        exclude.add(key);
        preserve.delete(key);
      }
    }

    await tx.execute(`DELETE FROM task_relations WHERE task_local_id = ?`, [
      taskLocalId,
    ]);

    const inserted = new Set<string>();
    for (const [kind, peers] of Object.entries(related)) {
      if (!peers) continue;
      for (const peer of peers) {
        const [row] = await tx.select<{ local_id: string }[]>(
          `SELECT local_id FROM tasks WHERE server_id = ? LIMIT 1`,
          [peer.id],
        );
        const otherLocalId: string | null = row?.local_id ?? null;
        if (otherLocalId && exclude.has(`${otherLocalId}|${kind}`)) continue;
        await tx.execute(
          `INSERT OR REPLACE INTO task_relations
             (task_local_id, other_task_local_id, other_task_server_id,
              relation_kind, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            taskLocalId,
            otherLocalId,
            otherLocalId ? null : peer.id,
            kind,
            null,
          ],
        );
        if (otherLocalId) inserted.add(`${otherLocalId}|${kind}`);
      }
    }

    for (const [, { other, kind }] of preserve) {
      const key = `${other}|${kind}`;
      if (inserted.has(key)) continue;
      await tx.execute(
        `INSERT OR REPLACE INTO task_relations
           (task_local_id, other_task_local_id, other_task_server_id,
            relation_kind, created_at)
         VALUES (?, ?, NULL, ?, ?)`,
        [taskLocalId, other, kind, new Date().toISOString()],
      );
    }
  });

}

/** List a task's relations, joining the peer's title + done state for
 * locally-resolved peers, and falling back to the carried server id +
 * a placeholder title for peers we haven't pulled yet. */
export async function listRelationsForTask(
  taskLocalId: string,
): Promise<TaskRelation[]> {
  const db = await getDb();
  const rows = await db.select<RelationRow[]>(
    `SELECT r.relation_kind,
            r.other_task_local_id,
            r.other_task_server_id,
            t.title       AS other_title,
            t.done        AS other_done,
            p.server_id   AS other_project_server_id,
            r.created_at
       FROM task_relations r
       LEFT JOIN tasks t  ON t.local_id = r.other_task_local_id
       LEFT JOIN projects p ON p.local_id = t.project_local_id
      WHERE r.task_local_id = ?
      ORDER BY r.relation_kind ASC, r.created_at ASC, r.other_task_server_id ASC`,
    [taskLocalId],
  );
  return rows.map((r) => ({
    kind: r.relation_kind as TaskRelationKind,
    otherTaskLocalId: r.other_task_local_id,
    otherTaskServerId: r.other_task_server_id,
    otherTaskTitle: r.other_title ?? '(not yet synced)',
    otherTaskDone: r.other_done === 1,
    otherTaskProjectServerId: r.other_project_server_id,
    createdAt: r.created_at,
  }));
}

/** Add a relation to a task and queue the sync.
 *
 * Mirrors Vikunja's approach of storing two rows per relation — one in
 * each direction — so querying by `task_local_id` alone gives the full
 * picture for that task without needing an inverse-join. The server
 * creates the inverse on the other task automatically via
 * `getInverseRelation` on the wire; our local inverse is kept in sync
 * by the next pull of the peer task.
 */
export async function addRelation(
  taskLocalId: string,
  otherTaskLocalId: string,
  kind: TaskRelationKind,
): Promise<void> {
  const now = new Date().toISOString();
  const inverseKind = inverseRelationKind(kind);
  await withTx(async (tx) => {
    await tx.execute(
      `INSERT OR REPLACE INTO task_relations
         (task_local_id, other_task_local_id, other_task_server_id,
          relation_kind, created_at)
       VALUES (?, ?, NULL, ?, ?)`,
      [taskLocalId, otherTaskLocalId, kind, now],
    );
    await tx.execute(
      `INSERT OR REPLACE INTO task_relations
         (task_local_id, other_task_local_id, other_task_server_id,
          relation_kind, created_at)
       VALUES (?, ?, NULL, ?, ?)`,
      [otherTaskLocalId, taskLocalId, inverseKind, now],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task_relation', ?, 'add', ?, ?)`,
      [taskLocalId, JSON.stringify({ otherTaskLocalId, kind }), now],
    );
  });
  notify('tasks');
  notify('outbox');
}

/** Remove a relation and queue the sync.
 *
 * Deletes both the forward and inverse rows (matching Vikunja's Delete
 * which removes both directions via a single `builder.Or` condition).
 */
export async function removeRelation(
  taskLocalId: string,
  otherTaskLocalId: string | null,
  otherTaskServerId: number | null,
  kind: TaskRelationKind,
): Promise<void> {
  const now = new Date().toISOString();
  const inverseKind = inverseRelationKind(kind);
  await withTx(async (tx) => {
    if (otherTaskLocalId) {
      await tx.execute(
        `DELETE FROM task_relations
          WHERE task_local_id = ? AND other_task_local_id = ? AND relation_kind = ?`,
        [taskLocalId, otherTaskLocalId, kind],
      );
      await tx.execute(
        `DELETE FROM task_relations
          WHERE task_local_id = ? AND other_task_local_id = ? AND relation_kind = ?`,
        [otherTaskLocalId, taskLocalId, inverseKind],
      );
    } else if (otherTaskServerId != null) {
      await tx.execute(
        `DELETE FROM task_relations
          WHERE task_local_id = ? AND other_task_server_id = ? AND relation_kind = ?`,
        [taskLocalId, otherTaskServerId, kind],
      );
    }
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task_relation', ?, 'remove', ?, ?)`,
      [
        taskLocalId,
        JSON.stringify({ otherTaskLocalId, otherTaskServerId, kind }),
        now,
      ],
    );
  });
  notify('tasks');
  notify('outbox');
}

/** A dependency edge between two tasks, in canonical (source→target)
 * direction, for drawing Gantt relation arrows. */
export interface GanttRelationEdge {
  fromLocalId: string;
  toLocalId: string;
  kind: 'blocking' | 'precedes';
}

/**
 * Load the dependency edges within a project for the Gantt chart.
 *
 * Only the canonical kinds `blocking` and `precedes` are returned — their
 * inverses (`blocked` / `follows`) are stored too but would draw the same
 * edge backwards, so we skip them. `task_local_id` is the source (blocker /
 * predecessor); `other_task_local_id` is the target.
 */
export async function listGanttRelationsForProject(
  projectLocalId: string,
): Promise<GanttRelationEdge[]> {
  const db = await getDb();
  const rows = await db.select<
    { task_local_id: string; other_task_local_id: string; relation_kind: string }[]
  >(
    `SELECT r.task_local_id, r.other_task_local_id, r.relation_kind
       FROM task_relations r
       JOIN tasks t ON t.local_id = r.task_local_id
      WHERE r.relation_kind IN ('blocking', 'precedes')
        AND t.project_local_id = ?
        AND t.deleted = 0`,
    [projectLocalId],
  );
  return rows.map((r) => ({
    fromLocalId: r.task_local_id,
    toLocalId: r.other_task_local_id,
    kind: r.relation_kind as 'blocking' | 'precedes',
  }));
}

/** Load all subtask parent→child mappings within a project. */
export async function listSubtaskRelationsForProject(
  projectLocalId: string,
): Promise<Map<string, string[]>> {
  const db = await getDb();
  const rows = await db.select<{ task_local_id: string; other_task_local_id: string }[]>(
    `SELECT r.task_local_id, r.other_task_local_id
     FROM task_relations r
     JOIN tasks t ON t.local_id = r.task_local_id
     WHERE r.relation_kind = 'subtask'
       AND t.project_local_id = ?
       AND t.deleted = 0`,
    [projectLocalId],
  );
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const children = map.get(row.task_local_id) ?? [];
    children.push(row.other_task_local_id);
    map.set(row.task_local_id, children);
  }
  return map;
}
