import Foundation
import GRDB

/// One person assigned to a task.
public struct AssigneeRecord: Equatable, Sendable, Identifiable {
    public let userId: Int
    public let username: String?
    public var id: Int { userId }
}

extension CriaStore {
    /// The task's assignees, by name.
    public func assignees(forTask taskLocalId: String) throws -> [AssigneeRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT user_server_id, username FROM task_assignees
                 WHERE task_local_id = ? AND deleted = 0
                 ORDER BY username COLLATE NOCASE ASC, user_server_id ASC
                """, arguments: [taskLocalId]).map {
                AssigneeRecord(userId: $0["user_server_id"], username: $0["username"])
            }
        }
    }

    /// User mutation: assigns a user (from a user search) and queues the add.
    public func addAssignee(taskLocalId: String, userId: Int, username: String) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(sql: """
                INSERT OR REPLACE INTO task_assignees (task_local_id, user_server_id, username, updated_at, synced_at, dirty, deleted)
                VALUES (?, ?, ?, ?, NULL, 1, 0)
                """, arguments: [taskLocalId, userId, username, now])
            try connection.enqueue(
                .taskAssignee, localId: taskLocalId, operation: .add,
                payload: ["task_local_id": taskLocalId, "user_server_id": userId], at: now
            )
        }
    }

    /// User mutation: unassigns and queues the removal.
    public func removeAssignee(taskLocalId: String, userId: Int) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "DELETE FROM task_assignees WHERE task_local_id = ? AND user_server_id = ?", arguments: [taskLocalId, userId]
            )
            try connection.enqueue(
                .taskAssignee, localId: taskLocalId, operation: .remove,
                payload: ["task_local_id": taskLocalId, "user_server_id": userId], at: now
            )
        }
    }
}
