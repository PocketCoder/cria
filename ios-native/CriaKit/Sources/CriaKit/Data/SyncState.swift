import Foundation
import GRDB

/// Columns of the single-row `sync_state` table that hold pull watermarks.
public enum SyncColumn: String, Sendable {
    case projects = "projects_synced_at"
    case tasks = "tasks_synced_at"
    case labels = "labels_synced_at"
    case views = "views_synced_at"
    case buckets = "buckets_synced_at"
}

extension CriaStore {
    public func syncStamp(_ column: SyncColumn) throws -> String? {
        try database.writer.read { connection in
            try String.fetchOne(connection, sql: "SELECT \(column.rawValue) FROM sync_state WHERE id = 1")
        }
    }

    /// Silent: records the time a pull finished. Announces nothing (sync path).
    public func stampSync(_ column: SyncColumn, at date: Date = Date()) throws {
        let stamp = date.formatted(.iso8601)
        try database.writer.write { connection in
            try connection.execute(sql: "UPDATE sync_state SET \(column.rawValue) = ? WHERE id = 1", arguments: [stamp])
        }
    }

    public func liveTaskCount() throws -> Int {
        try database.writer.read { connection in
            try Int.fetchOne(connection, sql: "SELECT COUNT(*) FROM tasks WHERE deleted = 0") ?? 0
        }
    }

    /// Server ids of live projects (including negative saved-filter pseudo-projects).
    public func syncedProjects() throws -> [(localId: String, serverId: Int)] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT local_id, server_id FROM projects WHERE server_id IS NOT NULL AND deleted = 0
                """).map { (localId: $0["local_id"], serverId: $0["server_id"]) }
        }
    }

    public func projectServerId(localId: String) throws -> Int? {
        try database.writer.read { connection in
            try Int.fetchOne(connection, sql: "SELECT server_id FROM projects WHERE local_id = ? AND deleted = 0", arguments: [localId])
        }
    }

    public func taskServerId(localId: String) throws -> Int? {
        try database.writer.read { connection in
            try Int.fetchOne(connection, sql: "SELECT server_id FROM tasks WHERE local_id = ? AND deleted = 0", arguments: [localId])
        }
    }

    /// Live kanban views that have a server id, with their project's server id.
    public func syncedKanbanViews(projectLocalId: String? = nil) throws -> [(viewLocalId: String, viewServerId: Int, projectServerId: Int)] {
        try database.writer.read { connection in
            var sql = """
                SELECT pv.local_id AS vl, pv.server_id AS vs, p.server_id AS ps
                  FROM project_views pv JOIN projects p ON p.local_id = pv.project_local_id
                 WHERE pv.view_kind = 'kanban' AND pv.deleted = 0
                   AND pv.server_id IS NOT NULL AND p.server_id IS NOT NULL
                """
            var arguments = StatementArguments()
            if let projectLocalId {
                sql += " AND pv.project_local_id = ?"
                arguments = [projectLocalId]
            }
            return try Row.fetchAll(connection, sql: sql, arguments: arguments).map {
                (viewLocalId: $0["vl"], viewServerId: $0["vs"], projectServerId: $0["ps"])
            }
        }
    }

    /// Server ids of saved-filter pseudo-projects (`server_id < -1`).
    public func savedFilterProjectServerIds() throws -> [Int] {
        try database.writer.read { connection in
            try Int.fetchAll(connection, sql: "SELECT server_id FROM projects WHERE server_id < -1 AND deleted = 0")
        }
    }

    /// Silent: hard-deletes a pseudo-project row for a saved filter that no longer exists.
    public func deleteProjectRow(serverId: Int) throws {
        try database.writer.write { connection in
            try connection.execute(sql: "DELETE FROM projects WHERE server_id = ?", arguments: [serverId])
        }
    }
}
