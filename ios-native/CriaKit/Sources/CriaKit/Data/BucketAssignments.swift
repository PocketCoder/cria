import Foundation
import GRDB

extension CriaStore {
    /// The server ids of a view's stored columns, in board order.
    public func bucketServerIds(viewLocalId: String) throws -> [Int] {
        try database.writer.read { connection in
            try Int.fetchAll(connection, sql: """
                SELECT server_id FROM buckets
                 WHERE view_local_id = ? AND deleted = 0 AND server_id IS NOT NULL
                 ORDER BY position ASC
                """, arguments: [viewLocalId])
        }
    }

    /// Silent: makes a view's task-to-column placement match the server's complete listing. Tasks with a move or
    /// reorder still queued keep their local placement (the push will send it); pairs whose task or column is not known
    /// locally are skipped; a synced task the server no longer places in this view loses its stale row.
    public func replaceBucketAssignmentsFromServer(viewLocalId: String, _ assignments: [BucketAssignment]) throws {
        try database.writer.write { connection in
            let pending = Set(try String.fetchAll(connection, sql: """
                SELECT entity_local_id FROM outbox WHERE entity_type IN ('task_bucket', 'task_position')
                """))
            var placed = Set<String>()
            for item in assignments {
                let taskLocalId = try String.fetchOne(
                    connection, sql: "SELECT local_id FROM tasks WHERE server_id = ? LIMIT 1", arguments: [item.taskServerId]
                )
                let bucketLocalId = try String.fetchOne(
                    connection, sql: "SELECT local_id FROM buckets WHERE server_id = ? LIMIT 1", arguments: [item.bucketServerId]
                )
                guard let taskLocalId, let bucketLocalId else { continue }
                placed.insert(taskLocalId)
                guard !pending.contains(taskLocalId) else { continue }
                try connection.execute(sql: """
                    INSERT OR REPLACE INTO task_buckets (task_local_id, view_local_id, bucket_local_id, position)
                    VALUES (?, ?, ?, ?)
                    """, arguments: [taskLocalId, viewLocalId, bucketLocalId, item.position ?? 0])
            }
            let stale = try String.fetchAll(connection, sql: """
                SELECT tb.task_local_id FROM task_buckets tb JOIN tasks t ON t.local_id = tb.task_local_id
                 WHERE tb.view_local_id = ? AND t.server_id IS NOT NULL
                """, arguments: [viewLocalId]).filter { !placed.contains($0) && !pending.contains($0) }
            for taskLocalId in stale {
                try connection.execute(
                    sql: "DELETE FROM task_buckets WHERE task_local_id = ? AND view_local_id = ?", arguments: [taskLocalId, viewLocalId]
                )
            }
        }
    }
}

/// One task's column on a board, as the server lists it.
public struct BucketAssignment: Equatable, Sendable {
    public let taskServerId: Int
    public let bucketServerId: Int
    /// The task's position in the view, when the listing carries one.
    public let position: Double?

    public init(taskServerId: Int, bucketServerId: Int, position: Double? = nil) {
        self.taskServerId = taskServerId
        self.bucketServerId = bucketServerId
        self.position = position
    }
}
