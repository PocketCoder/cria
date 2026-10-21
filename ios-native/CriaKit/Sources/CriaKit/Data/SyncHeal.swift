import Foundation
import GRDB

/// Repairs for a device whose local copy drifted from the server. All silent (sync path): nothing is announced.
extension CriaStore {
    /// Clears every pull watermark, so the next cycle fetches everything instead of a delta.
    public func resetSyncStamps() throws {
        try database.writer.write { connection in
            try connection.execute(sql: """
                UPDATE sync_state SET projects_synced_at = NULL, tasks_synced_at = NULL, labels_synced_at = NULL,
                       views_synced_at = NULL, buckets_synced_at = NULL
                 WHERE id = 1
                """)
        }
    }

    /// Clears `dirty` and `deleted` on synced rows with nothing in the outbox or the dead-letter table: a discarded
    /// op, or an edit whose push cleared the flag only conditionally. A dead-lettered row is left alone, so the
    /// failed local edit stays on screen until the user retries or discards it. A pull leaves a dirty row alone and
    /// never brings back a deleted one, so an orphaned row stopped taking the server's changes for good. Afterwards
    /// the next pull overwrites it and the reconcile removes it if the server no longer has it. A task hidden by a
    /// project delete still queued stays hidden. Returns the number of rows freed.
    @discardableResult
    public func healOrphanedSyncFlags() throws -> Int {
        try database.writer.write { connection in
            var healed = 0
            try connection.execute(sql: """
                UPDATE tasks SET dirty = 0, deleted = 0
                 WHERE (dirty = 1 OR deleted = 1) AND server_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity_local_id = tasks.local_id)
                   AND NOT EXISTS (SELECT 1 FROM outbox_dead_letter d WHERE d.entity_local_id = tasks.local_id)
                   AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity_type = 'project' AND o.op = 'delete'
                                      AND o.entity_local_id = tasks.project_local_id)
                """)
            healed += connection.changesCount
            for table in ["projects", "labels"] {
                try connection.execute(sql: """
                    UPDATE \(table) SET dirty = 0, deleted = 0
                     WHERE (dirty = 1 OR deleted = 1) AND server_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity_local_id = \(table).local_id)
                       AND NOT EXISTS (SELECT 1 FROM outbox_dead_letter d WHERE d.entity_local_id = \(table).local_id)
                    """)
                healed += connection.changesCount
            }
            return healed
        }
    }
}

extension CriaStore {
    static func projectIsStored(_ connection: Database, serverId: Int) throws -> Bool {
        try Bool.fetchOne(connection, sql: "SELECT EXISTS(SELECT 1 FROM projects WHERE server_id = ?)", arguments: [serverId]) ?? false
    }
}
