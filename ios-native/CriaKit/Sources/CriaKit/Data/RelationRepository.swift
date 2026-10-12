import Foundation
import GRDB

/// One relation on a task, with the peer's title and done state when the peer is stored locally.
public struct RelationRecord: Equatable, Sendable {
    public let kind: String
    public let otherTaskLocalId: String?
    public let otherTaskServerId: Int?
    public let otherTitle: String
    public let otherDone: Bool
}

extension CriaStore {
    /// A task's relations, grouped by kind. Peers not pulled yet get a placeholder title.
    public func relations(forTask taskLocalId: String) throws -> [RelationRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT r.relation_kind, r.other_task_local_id, r.other_task_server_id, t.title AS other_title, t.done AS other_done
                  FROM task_relations r
                  LEFT JOIN tasks t ON t.local_id = r.other_task_local_id
                 WHERE r.task_local_id = ?
                 ORDER BY r.relation_kind ASC, r.created_at ASC, r.other_task_server_id ASC
                """, arguments: [taskLocalId]).map { row in
                RelationRecord(
                    kind: row["relation_kind"],
                    otherTaskLocalId: row["other_task_local_id"],
                    otherTaskServerId: row["other_task_server_id"],
                    otherTitle: row["other_title"] ?? "(not yet synced)",
                    otherDone: (row["other_done"] as Int?) == 1
                )
            }
        }
    }

    /// User mutation: stores the relation and its inverse on the peer (the server writes the inverse too), then queues the add.
    public func addRelation(taskLocalId: String, otherTaskLocalId: String, kind: TaskRelationKind) throws {
        guard taskLocalId != otherTaskLocalId else { return }
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            let insert = """
                INSERT OR REPLACE INTO task_relations (task_local_id, other_task_local_id, other_task_server_id, relation_kind, created_at)
                VALUES (?, ?, NULL, ?, ?)
                """
            try connection.execute(sql: insert, arguments: [taskLocalId, otherTaskLocalId, kind.rawValue, now])
            try connection.execute(sql: insert, arguments: [otherTaskLocalId, taskLocalId, kind.inverse.rawValue, now])
            try connection.enqueue(
                .taskRelation,
                localId: taskLocalId,
                operation: .add,
                payload: ["other_task_local_id": otherTaskLocalId, "kind": kind.rawValue],
                at: now
            )
        }
    }

    /// User mutation: a new task in the parent's project, linked as its subtask. The create op is queued before the
    /// relation op, so the outbox pushes them in that order.
    @discardableResult
    public func createSubtask(parentLocalId: String, title: String) throws -> TaskRecord {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let parent = try task(localId: parentLocalId) else { throw CriaStoreError.notFound(parentLocalId) }
        let child = try createTask(TaskInput(title: trimmed, projectLocalId: parent.projectLocalId))
        try addRelation(taskLocalId: parentLocalId, otherTaskLocalId: child.localId, kind: .subtask)
        return child
    }

    /// User mutation: removes both directions locally and queues the removal. Carries the peer's server id when known.
    public func removeRelation(taskLocalId: String, relation: RelationRecord) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            let kind = TaskRelationKind(rawValue: relation.kind)
            if let other = relation.otherTaskLocalId {
                let delete = "DELETE FROM task_relations WHERE task_local_id = ? AND other_task_local_id = ? AND relation_kind = ?"
                try connection.execute(sql: delete, arguments: [taskLocalId, other, relation.kind])
                if let inverse = kind?.inverse {
                    try connection.execute(sql: delete, arguments: [other, taskLocalId, inverse.rawValue])
                }
            } else if let serverId = relation.otherTaskServerId {
                try connection.execute(
                    sql: "DELETE FROM task_relations WHERE task_local_id = ? AND other_task_server_id = ? AND relation_kind = ?",
                    arguments: [taskLocalId, serverId, relation.kind]
                )
            }
            var payload: [String: Any] = ["kind": relation.kind]
            payload["other_task_local_id"] = relation.otherTaskLocalId
            payload["other_task_server_id"] = relation.otherTaskServerId
            try connection.enqueue(.taskRelation, localId: taskLocalId, operation: .remove, payload: payload, at: now)
        }
    }
}
