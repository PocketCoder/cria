import { formatDateTime } from '@/lib/dateFormat';
import { getDb, exec, withTx } from './index';
import { notify } from './bus';
import { normaliseDate } from '@/domain/task';

/**
 * Conflict resolution. Two modes:
 *
 *   - keep-mine     The local row is already dirty=1 and has an outbox
 *                   entry queued from the original mutation. We just need
 *                   to clear the conflict record — the push loop will
 *                   send our edit.
 *
 *   - use-theirs    Overwrite the local row with the remote snapshot,
 *                   clear dirty, drop the pending outbox entry (otherwise
 *                   we'd push the about-to-be-overwritten state), stamp
 *                   last_synced to the remote payload, then mark the
 *                   conflict resolved.
 *
 * Conflict rows aren't deleted — we mark `resolved_at` so the history is
 * keep-able. The `useConflicts` hook filters by `resolved_at IS NULL`.
 *
 * Both modes notify the relevant bus topics so the UI refreshes
 * immediately.
 */

interface ConflictRow {
  id: number;
  entity_type: string;
  entity_local_id: string;
  remote_snapshot: string;
}

async function getConflict(id: number): Promise<ConflictRow | null> {
  const db = await getDb();
  const rows = await db.select<ConflictRow[]>(
    `SELECT id, entity_type, entity_local_id, remote_snapshot
       FROM conflicts WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function resolveConflictKeepMine(conflictId: number): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE conflicts SET resolved_at = ? WHERE id = ?`, [now, conflictId]);
  notify('conflicts');
}

export async function resolveConflictUseTheirs(conflictId: number): Promise<void> {
  const c = await getConflict(conflictId);
  if (!c) return;
  const remote = JSON.parse(c.remote_snapshot) as Record<string, unknown>;
  const now = new Date().toISOString();

  if (c.entity_type === 'task') {
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE tasks SET
           title         = ?,
           description   = ?,
           done          = ?,
           done_at       = ?,
           due_date      = ?,
           start_date    = ?,
           end_date      = ?,
           priority      = ?,
           percent_done  = ?,
           hex_color     = ?,
           position      = ?,
           is_favorite   = ?,
           repeat_after  = ?,
           repeat_mode   = ?,
           updated_at    = ?,
           synced_at     = ?,
           last_synced   = ?,
           dirty         = 0
         WHERE local_id = ?`,
        [
          (remote.title as string | undefined) ?? '',
          (remote.description as string | null | undefined) ?? null,
          remote.done === true ? 1 : 0,
          normaliseDate(remote.done_at as string | null | undefined),
          normaliseDate(remote.due_date as string | null | undefined),
          normaliseDate(remote.start_date as string | null | undefined),
          normaliseDate(remote.end_date as string | null | undefined),
          (remote.priority as number | undefined) ?? 0,
          (remote.percent_done as number | undefined) ?? 0,
          (remote.hex_color as string | null | undefined) ?? null,
          (remote.position as number | null | undefined) ?? null,
          remote.is_favorite === true ? 1 : 0,
          (remote.repeat_after as number | undefined) ?? 0,
          (remote.repeat_mode as number | undefined) ?? 0,
          (remote.updated as string | undefined) ?? now,
          now,
          c.remote_snapshot,
          c.entity_local_id,
        ],
      );

      // Drop any pending outbox entries for this task — they would push
      // the now-overwritten state otherwise.
      await tx.execute(
        `DELETE FROM outbox WHERE entity_type = 'task' AND entity_local_id = ?`,
        [c.entity_local_id],
      );

      await tx.execute(
        `UPDATE conflicts SET resolved_at = ? WHERE id = ?`,
        [now, conflictId],
      );
    });
    notify('tasks');
    notify('outbox');
  } else {
    // Project / label conflicts aren't created today (no mutations yet);
    // when they are, extend this branch. For now just resolve the row.
    await exec(`UPDATE conflicts SET resolved_at = ? WHERE id = ?`, [now, conflictId]);
  }
  notify('conflicts');
}

/**
 * Field-level metadata used by the UI to render a per-field diff. The
 * `fields` column in the conflicts table is a JSON array of column
 * names that diverged.
 */
export interface ConflictFieldDiff {
  field: string;
  /** Human-friendly label. */
  label: string;
  local: string;
  remote: string;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  done: 'Done',
  due_date: 'Due date',
  start_date: 'Start date',
  end_date: 'End date',
  priority: 'Priority',
  percent_done: 'Progress',
  hex_color: 'Colour',
  position: 'Position',
};

export function diffConflict(
  fieldsJson: string,
  localSnapshot: string,
  remoteSnapshot: string,
): ConflictFieldDiff[] {
  let fields: string[];
  try {
    fields = JSON.parse(fieldsJson) as string[];
  } catch {
    fields = [];
  }
  let local: Record<string, unknown> = {};
  let remote: Record<string, unknown> = {};
  try {
    local = JSON.parse(localSnapshot) as Record<string, unknown>;
  } catch {
    /* leave empty */
  }
  try {
    remote = JSON.parse(remoteSnapshot) as Record<string, unknown>;
  } catch {
    /* leave empty */
  }
  return fields.map((f) => ({
    field: f,
    label: FIELD_LABELS[f] ?? f,
    local: renderValue(local[f]),
    remote: renderValue(remote[f]),
  }));
}

// Matches an ISO-8601 datetime like "2026-05-28T01:00:00+01:00" so we can
// render due/start/end dates human-readably instead of dumping the raw
// string (issue #34).
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (v === '0001-01-01T00:00:00Z') return '—'; // Vikunja "no date" sentinel
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') {
    if (ISO_DATETIME.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return formatDateTime(d);
    }
    return v;
  }
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
