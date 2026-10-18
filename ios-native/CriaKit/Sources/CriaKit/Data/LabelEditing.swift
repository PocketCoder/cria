import Foundation
import GRDB

public enum LabelEditError: Error, Equatable {
    /// The title was empty once trimmed; Vikunja rejects a label without one.
    case emptyTitle
}

extension CriaStore {
    /// User mutation: renames and recolours a label, then queues an update. The push reads the row at send time and
    /// posts title, description and colour (Vikunja's update writes all three, so the description is kept as stored).
    /// The colour is stored without `#`, as the server sends it; nil clears it. Ported from `updateLabel` in
    /// `src/db/labels.ts`.
    @discardableResult
    public func updateLabel(localId: String, title: String, hexColor: String?) throws -> LabelRecord {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw LabelEditError.emptyTitle }
        let colour = stripHash(hexColor?.trimmingCharacters(in: .whitespaces))
        return try userWrite(announcing: [.labels, .tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(sql: """
                UPDATE labels SET title = ?, hex_color = ?, updated_at = ?, dirty = 1
                 WHERE local_id = ? AND deleted = 0
                """, arguments: [name, colour, now, localId])
            guard connection.changesCount > 0, let row = try Row.fetchOne(
                connection, sql: "SELECT \(CriaStore.labelColumns) FROM labels WHERE local_id = ?", arguments: [localId]
            ) else { throw CriaStoreError.notFound(localId) }
            try connection.enqueue(.label, localId: localId, operation: .update, payload: [
                "title": name,
                "hex_color": jsonNullable(colour)
            ], at: now)
            return LabelRecord(row: row)
        }
    }

    /// User mutation: soft-deletes the label and unlinks it from every task locally, so its chips go at once. Only
    /// the label delete is queued: Vikunja's `Label.Delete` removes its `label_tasks` rows itself, so per-task
    /// removals would be redundant. The pull leaves the row alone while it is dirty, and the push drops it after the
    /// server DELETE. Ported from `deleteLabel` in `src/db/labels.ts`.
    public func deleteLabel(localId: String) throws {
        try userWrite(announcing: [.labels, .tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE labels SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ? AND deleted = 0",
                arguments: [now, localId]
            )
            guard connection.changesCount > 0 else { return }
            try connection.execute(sql: "DELETE FROM task_labels WHERE label_local_id = ?", arguments: [localId])
            try connection.enqueue(.label, localId: localId, operation: .delete, payload: [:], at: now)
        }
    }

    /// Tasks carrying the label, open and done, for the delete confirmation.
    public func taskCount(forLabel localId: String) throws -> Int {
        try database.writer.read { connection in
            try Int.fetchOne(connection, sql: """
                SELECT COUNT(*) FROM task_labels tl JOIN tasks t ON t.local_id = tl.task_local_id
                 WHERE tl.label_local_id = ? AND tl.deleted = 0 AND t.deleted = 0
                """, arguments: [localId]) ?? 0
        }
    }

    /// The labels on the most tasks (open and done), most used first, leaving out those already on `taskLocalId`:
    /// the task panel's one-click suggestions.
    public func popularLabels(excludingTask taskLocalId: String, limit: Int = 6) throws -> [LabelRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT l.local_id, l.server_id, l.title, l.description, l.hex_color, l.updated_at
                  FROM labels l
                  JOIN task_labels tl ON tl.label_local_id = l.local_id AND tl.deleted = 0
                  JOIN tasks t ON t.local_id = tl.task_local_id AND t.deleted = 0
                 WHERE l.deleted = 0
                   AND l.local_id NOT IN (SELECT label_local_id FROM task_labels WHERE task_local_id = ? AND deleted = 0)
                 GROUP BY l.local_id
                 ORDER BY COUNT(*) DESC, l.title COLLATE NOCASE ASC
                 LIMIT ?
                """, arguments: [taskLocalId, limit]).map(LabelRecord.init(row:))
        }
    }
}
