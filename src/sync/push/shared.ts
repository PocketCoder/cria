import { callApi } from '@/api/client';
import { exec } from '@/db';
import { notify } from '@/db/bus';
import { ApiError } from '@/api/errors';

export interface OutboxRow {
  id: number;
  entity_type: string;
  entity_local_id: string;
  op: string;
  payload: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

export interface ProjectLookup {
  server_id: number | null;
}

export interface TaskRow {
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
  is_favorite: number;
  repeat_after: number;
  repeat_mode: number;
  updated_at: string;
  deleted: number;
}

/** Call an API function, treating HTTP 404 as success (entity already gone).
 *  Returns the response on success, null on 404. Lets all other errors through. */
export async function callApiIgnore404<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T | null> {
  try {
    return await callApi(promise);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface LabelLookup {
  server_id: number | null;
}

/* ──────── crash-idempotency helpers ──────────── */

/**
 * Read a cached server_id from a create op's payload. When a create API
 * call succeeds but the app crashes before saving server_id locally,
 * cacheCreateResponse stores it in the payload so the retry skips the API.
 */
export function cachedCreateResponse(payload: string): number | null {
  try {
    const p = JSON.parse(payload);
    return typeof p._cachedServerId === 'number' ? p._cachedServerId : null;
  } catch {
    return null;
  }
}

/** Persist a successful create response in the outbox payload. */
export async function cacheCreateResponse(
  opId: number,
  payload: string,
  serverId: number | undefined,
): Promise<void> {
  if (typeof serverId !== 'number') return;
  try {
    const parsed = JSON.parse(payload);
    parsed._cachedServerId = serverId;
    await exec('UPDATE outbox SET payload = ? WHERE id = ?', [JSON.stringify(parsed), opId]);
  } catch {
    // Payload isn't valid JSON — skip caching (best-effort).
  }
}

/**
 * Compare the server's current state against our `last_synced` snapshot.
 * If they differ on any conflict-relevant field, record a conflict row
 * and return true — the caller should abort the push so the user can
 * resolve before we overwrite the server's version.
 *
 * Only meaningful for UPDATE ops (create has no prior state, delete is
 * destructive by nature).
 */
export async function checkDivergence(
  lastSynced: string | null,
  currentServerPayload: Record<string, unknown>,
  conflictFields: readonly string[],
  entityType: string,
  localId: string,
): Promise<boolean> {
  if (!lastSynced) return false;

  let before: Record<string, unknown>;
  try {
    before = JSON.parse(lastSynced) as Record<string, unknown>;
  } catch {
    return false; // garbled snapshot; can't compare
  }

  const diverged = conflictFields.filter((f) => before[f] !== currentServerPayload[f]);
  if (diverged.length === 0) return false;

  const now = new Date().toISOString();
  await exec(
    `INSERT INTO conflicts
       (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      localId,
      JSON.stringify(diverged),
      lastSynced,
      JSON.stringify(currentServerPayload),
      now,
    ],
  );
  notify('conflicts');
  return true;
}
