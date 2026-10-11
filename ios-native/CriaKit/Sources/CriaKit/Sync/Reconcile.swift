import Foundation
import GRDB

/// Removes local rows the server no longer has. Ported from `src/sync/reconcile.ts`.
/// A row with a pending local edit (`dirty = 1`) is never removed.
extension Puller {
    public func reconcileDeletions() async throws {
        // Rows touched after this moment were created or pushed while the lists were being fetched, so the lists
        // cannot vouch for them either way.
        let started = isoNow()
        let tasks = try await serverIds("/tasks")
        if !tasks.truncated { try store.removeTasksMissingOnServer(serverIds: tasks.ids, fetchedSince: started) }
        let projects = try await serverIds("/projects")
        if !projects.truncated { try store.removeProjectsMissingOnServer(serverIds: projects.ids, fetchedSince: started) }
        store.bus.notify(.tasks)
        store.bus.notify(.projects)
    }

    /// `truncated` means the page cap was hit: the list is incomplete, so nothing may be deleted on its evidence.
    private func serverIds(_ path: String) async throws -> (ids: Set<Int>, truncated: Bool) {
        let raws = try await api.fetchAllPages(path)
        let truncated = raws.count >= defaultPerPage * maxPages
        var ids = Set<Int>()
        for data in raws {
            if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = object["id"] as? Int {
                ids.insert(id)
            }
        }
        return (ids, truncated)
    }
}

extension CriaStore {
    static func deleteTaskCascade(_ connection: Database, localId: String) throws {
        // task_comments references tasks with no ON DELETE clause (migration 013), so its rows must go first or the
        // task delete fails the foreign key check.
        for table in ["task_labels", "task_buckets", "task_reminders", "task_assignees", "task_comments"] {
            try connection.execute(sql: "DELETE FROM \(table) WHERE task_local_id = ?", arguments: [localId])
        }
        try connection.execute(
            sql: "DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?", arguments: [localId, localId]
        )
        try connection.execute(sql: "DELETE FROM tasks WHERE local_id = ?", arguments: [localId])
    }

    /// Comments of every task in a project, before the project (and through ON DELETE CASCADE, its tasks) goes.
    static func deleteCommentsOfProject(_ connection: Database, projectLocalId: String) throws {
        try connection.execute(sql: """
            DELETE FROM task_comments WHERE task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)
            """, arguments: [projectLocalId])
    }

    func removeTasksMissingOnServer(serverIds: Set<Int>, fetchedSince: String? = nil) throws {
        try database.writer.write { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT local_id, server_id, dirty, synced_at,
                       EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_local_id = tasks.local_id) AS queued
                  FROM tasks WHERE server_id IS NOT NULL
                """)
            for row in rows {
                let serverId: Int = row["server_id"]
                let dirty: Bool = row["dirty"]
                let queued: Bool = row["queued"]
                let syncedAt: String? = row["synced_at"]
                if serverIds.contains(serverId) || dirty || queued || CriaStore.touched(syncedAt, since: fetchedSince) { continue }
                try CriaStore.deleteTaskCascade(connection, localId: row["local_id"])
            }
        }
    }

    /// True when a row was written after `since` (timestamps have one-second resolution, so the same second does not
    /// count), so a list fetched from `since` onwards cannot judge it.
    static func touched(_ syncedAt: String?, since: String?) -> Bool {
        guard let since, let syncedAt else { return false }
        return syncedAt > since
    }

    func removeProjectsMissingOnServer(serverIds: Set<Int>, fetchedSince: String? = nil) throws {
        try database.writer.write { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT local_id, server_id, dirty, synced_at,
                       EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'project' AND entity_local_id = projects.local_id) AS queued
                  FROM projects WHERE server_id IS NOT NULL
                """)
            for row in rows {
                let serverId: Int = row["server_id"]
                let dirty: Bool = row["dirty"]
                let queued: Bool = row["queued"]
                let syncedAt: String? = row["synced_at"]
                if serverIds.contains(serverId) || dirty || queued || CriaStore.touched(syncedAt, since: fetchedSince) { continue }
                let localId: String = row["local_id"]
                let children = try String.fetchAll(
                    connection, sql: "SELECT local_id FROM tasks WHERE project_local_id = ? AND dirty = 0", arguments: [localId]
                )
                for child in children {
                    try CriaStore.deleteTaskCascade(connection, localId: child)
                }
                try CriaStore.deleteCommentsOfProject(connection, projectLocalId: localId)
                try connection.execute(sql: "DELETE FROM projects WHERE local_id = ?", arguments: [localId])
            }
        }
    }
}
