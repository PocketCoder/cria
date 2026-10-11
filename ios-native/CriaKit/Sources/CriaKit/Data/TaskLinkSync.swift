import Foundation
import GRDB

/// Sync-path (silent) writes for a task's label and assignee links. A pending local toggle is preserved
/// so a pull cannot wipe a label or assignee the user just changed before the push landed.
extension CriaStore {
    /// Replaces the task's label links with the server's. Skipped when the task has a pending local edit.
    public func replaceTaskLabelsFromServer(taskLocalId: String, _ labels: [(payload: LabelResponse, rawJSON: String)]) throws {
        var labelLocalIds: [String] = []
        for item in labels {
            labelLocalIds.append(try upsertLabelFromServer(item.payload, rawJSON: item.rawJSON))
        }
        try database.writer.write { connection in
            guard try CriaStore.isClean(connection, taskLocalId: taskLocalId) else { return }
            var preserve = Set<String>()
            var exclude = Set<String>()
            for op in try CriaStore.pendingLinkOps(connection, entity: "task_label", taskLocalId: taskLocalId) {
                guard let labelId = op.payload["label_local_id"] as? String ?? op.payload["labelLocalId"] as? String else { continue }
                if op.isAdd {
                    preserve.insert(labelId)
                    exclude.remove(labelId)
                } else {
                    exclude.insert(labelId)
                    preserve.remove(labelId)
                }
            }
            let now = isoNow()
            try connection.execute(sql: "DELETE FROM task_labels WHERE task_local_id = ?", arguments: [taskLocalId])
            var inserted = Set<String>()
            for labelId in labelLocalIds where !exclude.contains(labelId) && !inserted.contains(labelId) {
                try connection.execute(sql: """
                    INSERT INTO task_labels (task_local_id, label_local_id, updated_at, synced_at, dirty, deleted)
                    VALUES (?, ?, ?, ?, 0, 0)
                    """, arguments: [taskLocalId, labelId, now, now])
                inserted.insert(labelId)
            }
            for labelId in preserve where !inserted.contains(labelId) {
                try connection.execute(sql: """
                    INSERT INTO task_labels (task_local_id, label_local_id, updated_at, synced_at, dirty, deleted)
                    VALUES (?, ?, ?, ?, 0, 0)
                    """, arguments: [taskLocalId, labelId, now, now])
            }
        }
    }

    /// Replaces the task's assignees with the server's. Skipped when the task has a pending local edit.
    public func replaceTaskAssigneesFromServer(taskLocalId: String, _ assignees: [AssigneeResponse]) throws {
        try database.writer.write { connection in
            guard try CriaStore.isClean(connection, taskLocalId: taskLocalId) else { return }
            var preserve = Set<Int>()
            var exclude = Set<Int>()
            for op in try CriaStore.pendingLinkOps(connection, entity: "task_assignee", taskLocalId: taskLocalId) {
                guard let userId = op.payload["user_server_id"] as? Int ?? op.payload["userServerId"] as? Int else { continue }
                if op.isAdd {
                    preserve.insert(userId)
                    exclude.remove(userId)
                } else {
                    exclude.insert(userId)
                    preserve.remove(userId)
                }
            }
            let now = isoNow()
            try connection.execute(sql: "DELETE FROM task_assignees WHERE task_local_id = ?", arguments: [taskLocalId])
            var inserted = Set<Int>()
            for assignee in assignees where !exclude.contains(assignee.id) && !inserted.contains(assignee.id) {
                try connection.execute(sql: """
                    INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, synced_at, dirty, deleted)
                    VALUES (?, ?, ?, ?, ?, 0, 0)
                    """, arguments: [taskLocalId, assignee.id, assignee.username ?? assignee.name, now, now])
                inserted.insert(assignee.id)
            }
            for userId in preserve where !inserted.contains(userId) {
                try connection.execute(sql: """
                    INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, synced_at, dirty, deleted)
                    VALUES (?, ?, NULL, ?, ?, 0, 0)
                    """, arguments: [taskLocalId, userId, now, now])
            }
        }
    }

    private static func isClean(_ connection: Database, taskLocalId: String) throws -> Bool {
        let dirty = try Bool.fetchOne(connection, sql: "SELECT dirty FROM tasks WHERE local_id = ?", arguments: [taskLocalId])
        return dirty != true
    }

    struct PendingLinkOp {
        let isAdd: Bool
        let payload: [String: Any]
    }

    private static func pendingLinkOps(_ connection: Database, entity: String, taskLocalId: String) throws -> [PendingLinkOp] {
        let rows = try Row.fetchAll(connection, sql: """
            SELECT entity_local_id, op, payload FROM outbox WHERE entity_type = ? ORDER BY id ASC
            """, arguments: [entity])
        var result: [PendingLinkOp] = []
        for row in rows {
            let entityId: String = row["entity_local_id"]
            // Label ops are keyed "task:label"; assignee ops by the task id alone.
            guard entityId == taskLocalId || entityId.hasPrefix("\(taskLocalId):") else { continue }
            let payloadText: String = row["payload"]
            guard let payload = try? jsonObject(payloadText) else { continue }
            let op: String = row["op"]
            result.append(PendingLinkOp(isAdd: op == "create" || op == "add", payload: payload))
        }
        return result
    }
}
