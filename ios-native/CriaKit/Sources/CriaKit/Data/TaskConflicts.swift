import Foundation
import GRDB

extension CriaStore {
    /// Writes a server task's fields onto its local row and marks it clean.
    static func writeServerFields(
        _ connection: Database, _ payload: TaskResponse, rawJSON: String, projectLocalId: String, localId: String, now: String
    ) throws {
        let arguments: [(any DatabaseValueConvertible)?] = [
            projectLocalId, payload.title, payload.description, payload.done ?? false, payload.doneAt,
            payload.dueDate, payload.startDate, payload.endDate, payload.priority ?? 0,
            payload.percentDone ?? 0, payload.hexColor, payload.position, payload.isFavorite ?? false,
            payload.isSubscribed ?? false,
            payload.repeatAfter ?? 0, payload.repeatMode ?? 0, payload.identifier, payload.updated ?? now,
            payload.created, CriaStore.rememberCreator(payload.createdBy), payload.coverImageAttachmentId ?? 0,
            now, rawJSON, localId
        ]
        try connection.execute(sql: """
            UPDATE tasks SET project_local_id = ?, title = ?, description = ?, done = ?, done_at = ?,
                   due_date = ?, start_date = ?, end_date = ?, priority = ?, percent_done = ?, hex_color = ?,
                   position = ?, is_favorite = ?, is_subscribed = ?, repeat_after = ?, repeat_mode = ?,
                   identifier = ?, updated_at = ?, created_at = ?, created_by_id = ?, cover_image_id = ?,
                   synced_at = ?, last_synced = ?, dirty = 0, deleted = 0
             WHERE local_id = ?
            """, arguments: StatementArguments(arguments))
    }

    /// The creator's id for the row, after noting their name and username for the table's Created By column.
    static func rememberCreator(_ creator: TaskResponse.CreatedBy?) -> Int? {
        guard let id = creator?.id else { return nil }
        UserNameDirectory.shared.remember([(id, creator?.name)], usernames: [(id, creator?.username)])
        return id
    }

    /// Fields compared for conflicts. Mirrors the TypeScript conflict field list for tasks.
    static let conflictFields = ["title", "description", "done", "due_date"]

    static func recordConflictIfDiverged(
        _ connection: Database, localId: String, lastSynced: String?, remoteJSON: String, now: String
    ) throws {
        try recordConflictIfDiverged(connection, entityType: "task", localId: localId, lastSynced: lastSynced,
                                     remoteJSON: remoteJSON, fields: conflictFields, now: now)
    }

    /// A pull found a row with a pending local edit whose server copy also changed one of `fields` since the last
    /// sync: record a conflict (once per pair of snapshots). Ported from `mergeFromServer` in `src/db/syncMerge.ts`.
    static func recordConflictIfDiverged(
        _ connection: Database, entityType: String, localId: String, lastSynced: String?, remoteJSON: String,
        fields candidates: [String], now: String
    ) throws {
        guard let lastSynced, lastSynced != remoteJSON else { return }
        let duplicate = try Int.fetchOne(connection, sql: """
            SELECT id FROM conflicts
             WHERE entity_type = ? AND entity_local_id = ?
               AND local_snapshot = ? AND remote_snapshot = ?
             LIMIT 1
            """, arguments: [entityType, localId, lastSynced, remoteJSON])
        guard duplicate == nil else { return }
        guard let before = try jsonObject(lastSynced), let after = try jsonObject(remoteJSON) else { return }
        let fields = candidates.filter { field in
            !conflictValuesEqual(field: field, before[field], after[field])
        }
        guard !fields.isEmpty else { return }
        let fieldsData = try JSONSerialization.data(withJSONObject: fields)
        let fieldsJSON = String(bytes: fieldsData, encoding: .utf8) ?? "[]"
        try connection.execute(sql: """
            INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """, arguments: [entityType, localId, fieldsJSON, lastSynced, remoteJSON, now])
    }

    static func jsonObject(_ text: String) throws -> [String: Any]? {
        try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
    }
}
