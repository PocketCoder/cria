import Foundation
import GRDB

/// Removes local rows the server no longer has. Ported from `src/sync/reconcile.ts`.
/// A row with a pending local edit (`dirty = 1`) is never removed.
extension Puller {
    public func reconcileDeletions() async throws {
        let taskIds = try await serverIds("/tasks")
        try store.removeTasksMissingOnServer(serverIds: taskIds)
        let projectIds = try await serverIds("/projects")
        try store.removeProjectsMissingOnServer(serverIds: projectIds)
        store.bus.notify(.tasks)
        store.bus.notify(.projects)
    }

    private func serverIds(_ path: String) async throws -> Set<Int> {
        let raws = try await api.fetchAllPages(path)
        var ids = Set<Int>()
        for data in raws {
            if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = object["id"] as? Int {
                ids.insert(id)
            }
        }
        return ids
    }
}

extension CriaStore {
    static func deleteTaskCascade(_ connection: Database, localId: String) throws {
        for table in ["task_labels", "task_buckets", "task_reminders", "task_assignees"] {
            try connection.execute(sql: "DELETE FROM \(table) WHERE task_local_id = ?", arguments: [localId])
        }
        try connection.execute(
            sql: "DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?", arguments: [localId, localId]
        )
        try connection.execute(sql: "DELETE FROM tasks WHERE local_id = ?", arguments: [localId])
    }

    func removeTasksMissingOnServer(serverIds: Set<Int>) throws {
        try database.writer.write { connection in
            let rows = try Row.fetchAll(connection, sql: "SELECT local_id, server_id, dirty FROM tasks WHERE server_id IS NOT NULL")
            for row in rows {
                let serverId: Int = row["server_id"]
                let dirty: Bool = row["dirty"]
                if serverIds.contains(serverId) || dirty { continue }
                try CriaStore.deleteTaskCascade(connection, localId: row["local_id"])
            }
        }
    }

    func removeProjectsMissingOnServer(serverIds: Set<Int>) throws {
        try database.writer.write { connection in
            let rows = try Row.fetchAll(connection, sql: "SELECT local_id, server_id, dirty FROM projects WHERE server_id IS NOT NULL")
            for row in rows {
                let serverId: Int = row["server_id"]
                let dirty: Bool = row["dirty"]
                if serverIds.contains(serverId) || dirty { continue }
                let localId: String = row["local_id"]
                let children = try String.fetchAll(
                    connection, sql: "SELECT local_id FROM tasks WHERE project_local_id = ? AND dirty = 0", arguments: [localId]
                )
                for child in children {
                    try CriaStore.deleteTaskCascade(connection, localId: child)
                }
                try connection.execute(sql: "DELETE FROM projects WHERE local_id = ?", arguments: [localId])
            }
        }
    }
}
