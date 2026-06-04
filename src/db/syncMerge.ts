/**
 * Centralised "merge a server payload into local SQLite" helper.
 *
 * Before this existed, every `upsertXFromServer` carried its own copy
 * of the dirty-guard logic — and we lost the bug-fix lottery three
 * times: deletes (re-resurrected), mid-flight edits (clobbered),
 * labels (clobbered again). Each fix touched a different repo because
 * the guard was duplicated.
 *
 * The rule, in one place:
 *
 *   ┌────────────────┬────────────────────────────────────────────────┐
 *   │ Local row?     │ Action                                         │
 *   ├────────────────┼────────────────────────────────────────────────┤
 *   │ Not present    │ INSERT it (caller supplies the SQL).           │
 *   │ Clean          │ UPDATE it (caller supplies the SQL).           │
 *   │ Dirty          │ Skip the write. The outbox is authoritative    │
 *   │                │ until it drains. If the server has *also*      │
 *   │                │ diverged from our last_synced snapshot,        │
 *   │                │ record a conflict so the user can resolve it.  │
 *   └────────────────┴────────────────────────────────────────────────┘
 *
 * The caller is responsible for column mapping (each entity has a
 * different shape, that's the legitimate per-entity bit). The helper
 * is responsible for the dirty-guard + conflict detection. If a new
 * repo wants different conflict-detection semantics it can pass its
 * own field list; otherwise the helper does field-by-field
 * comparison on a sensible default list.
 */

import { nanoid } from 'nanoid';
import { getDb, exec, type Database } from './index';

/** Which top-level entity is being merged. Drives the table name +
 * the value stored in `conflicts.entity_type`. */
export type SyncEntity = 'project' | 'task' | 'label' | 'view' | 'bucket';

/** Builds the SQL + params for the INSERT/UPDATE statements. Called
 * with the resolved `localId` and the JSON-stringified remote payload
 * (suitable for the `last_synced` column). */
export interface SyncStatement {
  sql: string;
  params: unknown[];
}

export interface MergeContract {
  entity: SyncEntity;
  serverId: number;
  /** Raw remote payload — stored as `last_synced` and used for
   * conflict-field comparison. */
  remotePayload: Record<string, unknown>;
  /** Build the INSERT for a new row at the given local_id. */
  insert: (localId: string, lastSyncedJson: string) => SyncStatement;
  /** Build the UPDATE for an existing clean row. */
  update: (localId: string, lastSyncedJson: string) => SyncStatement;
  /** Field names to compare when both sides diverged. Defaults are
   * conservative ("title", "description"); pass a fuller list for
   * tasks. */
  conflictFields?: readonly string[];
}

const TABLE: Record<SyncEntity, string> = {
  project: 'projects',
  task: 'tasks',
  label: 'labels',
  view: 'project_views',
  bucket: 'buckets',
};

const DEFAULT_CONFLICT_FIELDS: readonly string[] = ['title', 'description'];

interface ExistingRow {
  local_id: string;
  dirty: number;
  deleted: number;
  last_synced: string | null;
}

/**
 * Reads the existing row (if any) and dispatches to insert / update /
 * skip. Returns the row's `local_id` so callers can chain (e.g.
 * mirror task → label links).
 */
export async function mergeFromServer(c: MergeContract): Promise<string> {
  const table = TABLE[c.entity];
  const db = await getDb();

  const rows = await db.select<ExistingRow[]>(
    `SELECT local_id, dirty, deleted, last_synced
       FROM ${table} WHERE server_id = ? LIMIT 1`,
    [c.serverId],
  );
  const existing = rows[0];
  const remoteJson = JSON.stringify(c.remotePayload);

  if (!existing) {
    const localId = nanoid();
    const stmt = c.insert(localId, remoteJson);
    await exec(stmt.sql, stmt.params);
    return localId;
  }

  if (existing.dirty === 1) {
    await maybeRecordConflict(c, existing, remoteJson);
    return existing.local_id;
  }

  const stmt = c.update(existing.local_id, remoteJson);
  await exec(stmt.sql, stmt.params);
  return existing.local_id;
}

/**
 * Compare the local row's last-known-clean snapshot to the incoming
 * remote payload. If *both* sides diverged (local is dirty and the
 * server also moved on since we last synced) we write a row to the
 * conflicts table for the user to resolve.
 *
 * When only the local side moved (server is unchanged from
 * last_synced), we silently skip — the outbox will push our edit and
 * the next clean pull updates last_synced forward.
 */
async function maybeRecordConflict(
  c: MergeContract,
  existing: ExistingRow,
  remoteJson: string,
): Promise<void> {
  if (!existing.last_synced) return;
  if (existing.last_synced === remoteJson) return;

  let before: Record<string, unknown>;
  try {
    before = JSON.parse(existing.last_synced) as Record<string, unknown>;
  } catch {
    return; // garbled snapshot; nothing reliable to compare
  }

  const fields = (c.conflictFields ?? DEFAULT_CONFLICT_FIELDS).filter(
    (f) => before[f] !== c.remotePayload[f],
  );
  if (fields.length === 0) return;

  const now = new Date().toISOString();
  await exec(
    `INSERT INTO conflicts
       (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      c.entity,
      existing.local_id,
      JSON.stringify(fields),
      existing.last_synced,
      remoteJson,
      now,
    ],
  );
}

// Surface the helper's Database type for callers that need to query
// alongside it (e.g. tasks.ts resolves project_id → project_local_id
// before composing the upsert).
export type { Database };
