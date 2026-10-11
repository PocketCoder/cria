import Foundation
import GRDB

/// One unresolved conflict: a field the user edited locally that also changed on the server since the last sync.
/// Ported from `src/db/conflicts.ts`.
public struct ConflictRecord: Equatable, Sendable {
    public let id: Int
    public let entityType: String
    public let entityLocalId: String
    public let fields: [String]
    public let localSnapshot: String
    public let remoteSnapshot: String
    public let detectedAt: String

    init(row: Row) {
        id = row["id"]
        entityType = row["entity_type"]
        entityLocalId = row["entity_local_id"]
        let fieldsJSON: String = row["fields"]
        fields = (try? JSONDecoder().decode([String].self, from: Data(fieldsJSON.utf8))) ?? []
        localSnapshot = row["local_snapshot"]
        remoteSnapshot = row["remote_snapshot"]
        detectedAt = row["detected_at"]
    }

    public var diff: [ConflictFieldDiff] { diffConflict(fields: fields, localSnapshot: localSnapshot, remoteSnapshot: remoteSnapshot) }
}

/// Per-field rows for the conflict modal.
public struct ConflictFieldDiff: Equatable, Sendable {
    public let field: String
    public let label: String
    public let local: String
    public let remote: String
}

private let fieldLabels: [String: String] = [
    "title": "Title", "description": "Description", "done": "Done", "due_date": "Due date",
    "start_date": "Start date", "end_date": "End date", "priority": "Priority", "percent_done": "Progress",
    "hex_color": "Colour", "position": "Position"
]

public func diffConflict(fields: [String], localSnapshot: String, remoteSnapshot: String) -> [ConflictFieldDiff] {
    func object(_ text: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]) ?? [:]
    }
    let local = object(localSnapshot)
    let remote = object(remoteSnapshot)
    return fields.map { field in
        ConflictFieldDiff(field: field, label: fieldLabels[field] ?? field,
                          local: renderConflictValue(local[field]), remote: renderConflictValue(remote[field]))
    }
}

private func renderConflictValue(_ value: Any?) -> String {
    switch value {
    case nil, is NSNull: return "—"
    case let text as String:
        if !text.isEmpty, normaliseDate(text) == nil { return "—" }  // Vikunja's "no date" sentinel
        if text.count >= 19, let date = try? Date(text, strategy: .iso8601) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return text
    case let number as NSNumber:
        // JSONSerialization yields NSNumber for booleans too; tell them apart by the CF type.
        if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "yes" : "no" }
        return number.stringValue
    default:
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return "—" }
        return String(bytes: data, encoding: .utf8) ?? ""
    }
}

extension CriaStore {
    public func unresolvedConflicts() throws -> [ConflictRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: "SELECT * FROM conflicts WHERE resolved_at IS NULL ORDER BY id ASC")
                .map(ConflictRecord.init(row:))
        }
    }

    /// Keep mine: the local row is already dirty with an op queued, so only the conflict record is cleared and the
    /// push loop then sends the edit.
    public func resolveConflictKeepMine(id: Int) throws {
        try userWrite(announcing: [.conflicts]) { connection in
            try connection.execute(sql: "UPDATE conflicts SET resolved_at = ? WHERE id = ?", arguments: [isoNow(), id])
        }
    }

    /// Use theirs: overwrite the local row with the remote snapshot, clear dirty, drop the queued ops (they would
    /// push the state being overwritten), stamp `last_synced`, and resolve.
    public func resolveConflictUseTheirs(id: Int) throws {
        try userWrite(announcing: [.conflicts, .tasks, .outbox]) { connection in
            guard let row = try Row.fetchOne(connection, sql: "SELECT * FROM conflicts WHERE id = ?", arguments: [id]) else { return }
            let conflict = ConflictRecord(row: row)
            let now = isoNow()
            if conflict.entityType == "task",
               let remote = try CriaStore.jsonObject(conflict.remoteSnapshot) {
                try CriaStore.overwriteTask(connection, localId: conflict.entityLocalId, remote: remote,
                                            snapshot: conflict.remoteSnapshot, now: now)
                try connection.execute(
                    sql: "DELETE FROM outbox WHERE entity_type = 'task' AND entity_local_id = ?", arguments: [conflict.entityLocalId]
                )
            }
            // Project and label conflicts are only resolved as records for now, as in the TypeScript app.
            try connection.execute(sql: "UPDATE conflicts SET resolved_at = ? WHERE id = ?", arguments: [now, id])
        }
    }

    static func overwriteTask(_ connection: Database, localId: String, remote: [String: Any], snapshot: String, now: String) throws {
        func date(_ key: String) -> String? { normaliseDate(remote[key] as? String) }
        let arguments: [(any DatabaseValueConvertible)?] = [
            remote["title"] as? String ?? "", remote["description"] as? String, remote["done"] as? Bool ?? false,
            date("done_at"), date("due_date"), date("start_date"), date("end_date"),
            remote["priority"] as? Int ?? 0, (remote["percent_done"] as? NSNumber)?.doubleValue ?? 0,
            remote["hex_color"] as? String, (remote["position"] as? NSNumber)?.doubleValue,
            remote["is_favorite"] as? Bool ?? false, remote["repeat_after"] as? Int ?? 0, remote["repeat_mode"] as? Int ?? 0,
            remote["updated"] as? String ?? now, now, snapshot, localId
        ]
        try connection.execute(sql: """
            UPDATE tasks SET title = ?, description = ?, done = ?, done_at = ?, due_date = ?, start_date = ?,
                   end_date = ?, priority = ?, percent_done = ?, hex_color = ?, position = ?, is_favorite = ?,
                   repeat_after = ?, repeat_mode = ?, updated_at = ?, synced_at = ?, last_synced = ?, dirty = 0
             WHERE local_id = ?
            """, arguments: StatementArguments(arguments))
    }
}
