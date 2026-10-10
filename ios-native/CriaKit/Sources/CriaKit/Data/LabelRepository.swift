import Foundation
import GRDB

public struct LabelRecord: Equatable, Sendable {
    public let localId: String
    public let serverId: Int?
    public let title: String
    public let description: String?
    public let hexColor: String?
    public let updatedAt: String

    init(row: Row) {
        localId = row["local_id"]
        serverId = row["server_id"]
        title = row["title"]
        description = row["description"]
        hexColor = row["hex_color"]
        updatedAt = row["updated_at"]
    }
}

extension CriaStore {
    static let labelColumns = "local_id, server_id, title, description, hex_color, updated_at"

    public func labels() throws -> [LabelRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.labelColumns) FROM labels
                 WHERE deleted = 0 ORDER BY title COLLATE NOCASE ASC
                """).map(LabelRecord.init(row:))
        }
    }

    public func labels(forTask taskLocalId: String) throws -> [LabelRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT l.local_id, l.server_id, l.title, l.description, l.hex_color, l.updated_at
                  FROM labels l
                  JOIN task_labels tl ON tl.label_local_id = l.local_id
                 WHERE tl.task_local_id = ? AND tl.deleted = 0 AND l.deleted = 0
                 ORDER BY l.title COLLATE NOCASE ASC
                """, arguments: [taskLocalId]).map(LabelRecord.init(row:))
        }
    }

    /// Silent server merge for one label. A dirty row is left alone.
    @discardableResult
    public func upsertLabelFromServer(_ payload: LabelResponse, rawJSON: String) throws -> String {
        try database.writer.write { connection -> String in
            let now = isoNow()
            let existing = try Row.fetchOne(
                connection, sql: "SELECT local_id, dirty FROM labels WHERE server_id = ?", arguments: [payload.id]
            )
            if let existing {
                let localId: String = existing["local_id"]
                let dirty: Bool = existing["dirty"]
                if !dirty {
                    try connection.execute(sql: """
                        UPDATE labels SET title = ?, description = ?, hex_color = ?, updated_at = ?,
                               synced_at = ?, last_synced = ?, dirty = 0, deleted = 0
                         WHERE local_id = ?
                        """, arguments: [
                            payload.title, payload.description, payload.hexColor, payload.updated ?? now,
                            now, rawJSON, localId
                        ])
                }
                return localId
            }
            let localId = UUID().uuidString
            try connection.execute(sql: """
                INSERT INTO labels (local_id, server_id, title, description, hex_color, updated_at,
                       synced_at, last_synced, dirty, deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                """, arguments: [
                    localId, payload.id, payload.title, payload.description, payload.hexColor,
                    payload.updated ?? now, now, rawJSON
                ])
            return localId
        }
    }

    /// User mutation: links the label to the task, or unlinks it if already linked. Queues the change.
    public func toggleTaskLabel(taskLocalId: String, labelLocalId: String) throws {
        try userWrite(announcing: [.tasks, .labels, .outbox]) { connection in
            let now = isoNow()
            let linked = try Bool.fetchOne(connection, sql: """
                SELECT EXISTS(SELECT 1 FROM task_labels
                               WHERE task_local_id = ? AND label_local_id = ? AND deleted = 0)
                """, arguments: [taskLocalId, labelLocalId]) ?? false
            let nowDeleted = linked
            try connection.execute(sql: """
                INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT (task_local_id, label_local_id)
                DO UPDATE SET deleted = excluded.deleted, dirty = 1, updated_at = excluded.updated_at
                """, arguments: [taskLocalId, labelLocalId, now, nowDeleted])
            let entityId = "\(taskLocalId):\(labelLocalId)"
            try connection.enqueue(
                .taskLabel,
                localId: entityId,
                operation: nowDeleted ? .delete : .create,
                payload: ["task_local_id": taskLocalId, "label_local_id": labelLocalId],
                at: now
            )
        }
    }

    /// Silent: replaces a task's reminders with the server's. Used by the pull.
    public func replaceRemindersFromServer(taskLocalId: String, _ reminders: [TaskReminderResponse]) throws {
        try database.writer.write { connection in
            try connection.execute(sql: "DELETE FROM task_reminders WHERE task_local_id = ?", arguments: [taskLocalId])
            for reminder in reminders {
                try connection.execute(sql: """
                    INSERT OR IGNORE INTO task_reminders (task_local_id, reminder_at, relative_period, relative_to, notified)
                    VALUES (?, ?, ?, ?, 0)
                    """, arguments: [taskLocalId, normaliseDate(reminder.reminder), reminder.relativePeriod, reminder.relativeTo])
            }
        }
    }

    /// Silent: replaces a task's relations with the server's. Other tasks resolve to local ids when synced.
    public func replaceRelationsFromServer(taskLocalId: String, _ related: [String: [RelatedTaskResponse]]) throws {
        try database.writer.write { connection in
            try connection.execute(sql: "DELETE FROM task_relations WHERE task_local_id = ?", arguments: [taskLocalId])
            let now = isoNow()
            for (kind, tasks) in related {
                for other in tasks {
                    let otherLocalId = try String.fetchOne(
                        connection, sql: "SELECT local_id FROM tasks WHERE server_id = ?", arguments: [other.id]
                    )
                    try connection.execute(sql: """
                        INSERT INTO task_relations (task_local_id, other_task_local_id, other_task_server_id, relation_kind, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """, arguments: [taskLocalId, otherLocalId, other.id, kind, now])
                }
            }
        }
    }
}
