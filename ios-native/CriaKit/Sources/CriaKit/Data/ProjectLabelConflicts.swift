import Foundation
import GRDB

/// Conflicts on projects and labels: detected when a pull finds a row with a pending local edit whose server copy
/// changed since `last_synced`, as for tasks, on every field a user can edit. Resolution works on the whole row.
extension CriaStore {
    /// User-editable project fields, by server JSON key. `identifier` is left out: no screen edits it.
    static let projectConflictFields = ["title", "description", "hex_color", "parent_project_id", "is_archived", "is_favorite"]
    static let labelConflictFields = ["title", "description", "hex_color"]

    /// Pull side. A field conflicts when the server changed it since the last sync and the row on this device does
    /// not already hold the server's value: when both sides agree there is nothing to choose. Pushes store the reply as
    /// `last_synced`, but a reply lost after the server applied the edit leaves the old baseline, and the server's
    /// copy then echoes this device's edit. When nothing conflicts the snapshot moves up to the server's copy (every
    /// field the server changed already matches here), so the pre-push check does not trip on that echo either.
    static func recordSyncedEntityConflict(
        _ connection: Database, entityType: String, localId: String, lastSynced: String?, remoteJSON: String, now: String
    ) throws {
        guard let lastSynced, lastSynced != remoteJSON,
              let candidates = conflictFields(entityType),
              let before = (try? jsonObject(lastSynced)) ?? nil,
              let after = (try? jsonObject(remoteJSON)) ?? nil,
              let local = try localConflictValues(connection, entityType: entityType, localId: localId) else { return }
        let fields = candidates.filter { field in
            !syncedValuesEqual(field: field, before[field], after[field])
                && !syncedValuesEqual(field: field, local[field], after[field])
        }
        guard !fields.isEmpty else {
            let table = entityType == "project" ? "projects" : "labels"
            try connection.execute(sql: "UPDATE \(table) SET last_synced = ? WHERE local_id = ?", arguments: [remoteJSON, localId])
            return
        }
        let duplicate = try Bool.fetchOne(connection, sql: """
            SELECT EXISTS(SELECT 1 FROM conflicts
                           WHERE entity_type = ? AND entity_local_id = ? AND local_snapshot = ? AND remote_snapshot = ?)
            """, arguments: [entityType, localId, lastSynced, remoteJSON]) ?? false
        guard !duplicate else { return }
        let fieldsJSON = String(bytes: try JSONSerialization.data(withJSONObject: fields), encoding: .utf8) ?? "[]"
        try connection.execute(sql: """
            INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """, arguments: [entityType, localId, fieldsJSON, lastSynced, remoteJSON, now])
    }

    static func conflictFields(_ entityType: String) -> [String]? {
        switch entityType {
        case "project": projectConflictFields
        case "label": labelConflictFields
        default: nil
        }
    }

    /// `conflictValuesEqual`, plus the server's spellings of "none": parent 0 is no parent, a missing flag is false.
    static func syncedValuesEqual(field: String, _ lhs: Any?, _ rhs: Any?) -> Bool {
        switch field {
        case "parent_project_id": return parentKey(lhs) == parentKey(rhs)
        case "is_archived", "is_favorite": return ((lhs as? Bool) ?? false) == ((rhs as? Bool) ?? false)
        default: return conflictValuesEqual(field: field, lhs, rhs)
        }
    }

    /// A parent as compared: a server id, 0 for none, or the local id of a parent the server has not seen yet.
    private static func parentKey(_ value: Any?) -> String {
        if let local = value as? String { return local }
        return String(jsonInt(value) ?? 0)
    }

    private static func jsonInt(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        return (value as? NSNumber)?.intValue
    }

    /// The row as it is on this device, keyed and typed like the server's JSON (it goes through a JSON round trip, so
    /// it compares with snapshots value for value). A parent with no server id yet is given as its local id.
    static func localConflictValues(_ connection: Database, entityType: String, localId: String) throws -> [String: Any]? {
        var values: [String: Any]
        switch entityType {
        case "project":
            guard let row = try Row.fetchOne(
                connection, sql: "SELECT \(projectColumns) FROM projects WHERE local_id = ?", arguments: [localId]
            ) else { return nil }
            let project = ProjectRecord(row: row)
            values = [
                "title": project.title, "description": jsonNullable(project.description),
                "hex_color": jsonNullable(project.hexColor), "is_archived": project.isArchived,
                "is_favorite": project.isFavorite, "position": jsonNullable(project.position),
                "identifier": jsonNullable(project.identifier)
            ]
            if let parent = project.parentLocalId {
                let serverId = try Int.fetchOne(connection, sql: "SELECT server_id FROM projects WHERE local_id = ?", arguments: [parent])
                values["parent_project_id"] = serverId.map { $0 as Any } ?? parent
            }
        case "label":
            guard let row = try Row.fetchOne(
                connection, sql: "SELECT \(labelColumns) FROM labels WHERE local_id = ?", arguments: [localId]
            ) else { return nil }
            let label = LabelRecord(row: row)
            values = ["title": label.title, "description": jsonNullable(label.description), "hex_color": jsonNullable(label.hexColor)]
        default:
            return nil
        }
        let data = try JSONSerialization.data(withJSONObject: values)
        return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    /// Keep mine for a project or label: a three-way merge against the snapshot the conflict was found on. A field
    /// edited here keeps the edit; a field left alone takes the server's value, so the full-object update that
    /// follows does not revert changes made elsewhere. The server's copy becomes the baseline and an update is queued.
    static func keepMineMerged(_ connection: Database, conflict: ConflictRecord, now: String) throws {
        let localId = conflict.entityLocalId
        guard let base = (try? jsonObject(conflict.localSnapshot)) ?? nil,
              let remote = (try? jsonObject(conflict.remoteSnapshot)) ?? nil,
              let local = try localConflictValues(connection, entityType: conflict.entityType, localId: localId),
              try Bool.fetchOne(connection, sql: """
                  SELECT deleted = 0 FROM \(conflict.entityType == "project" ? "projects" : "labels") WHERE local_id = ?
                  """, arguments: [localId]) == true else { return }
        func edited(_ field: String) -> Bool { !syncedValuesEqual(field: field, local[field], base[field]) }
        func pick(_ field: String) -> Any? { edited(field) ? local[field] : remote[field] }
        let entity: OutboxEntity
        let payload: [String: Any]
        if conflict.entityType == "project" {
            let parentArgument: (any DatabaseValueConvertible)? = edited("parent_project_id")
                ? nil : try remoteParentLocalId(connection, remote: remote, localId: localId)
            try connection.execute(sql: """
                UPDATE projects SET title = ?, description = ?, hex_color = ?, is_archived = ?, is_favorite = ?,
                       position = ?, identifier = ?, parent_local_id = CASE WHEN ? THEN parent_local_id ELSE ? END,
                       last_synced = ?, updated_at = ?, dirty = 1
                 WHERE local_id = ?
                """, arguments: [
                    pick("title") as? String ?? "", pick("description") as? String, pick("hex_color") as? String,
                    pick("is_archived") as? Bool ?? false, pick("is_favorite") as? Bool ?? false,
                    (pick("position") as? NSNumber)?.doubleValue, pick("identifier") as? String,
                    edited("parent_project_id"), parentArgument, conflict.remoteSnapshot, now, localId
                ])
            guard let record = try fetchProject(connection, localId: localId) else { return }
            (entity, payload) = (.project, projectPayload(record))
        } else {
            try connection.execute(sql: """
                UPDATE labels SET title = ?, description = ?, hex_color = ?, last_synced = ?, updated_at = ?, dirty = 1
                 WHERE local_id = ?
                """, arguments: [
                    pick("title") as? String ?? "", pick("description") as? String, pick("hex_color") as? String,
                    conflict.remoteSnapshot, now, localId
                ])
            (entity, payload) = (.label, [
                "title": pick("title") as? String ?? "", "description": jsonNullable(pick("description") as? String),
                "hex_color": jsonNullable(pick("hex_color") as? String)
            ])
        }
        let queued = try Bool.fetchOne(connection, sql: """
            SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type = ? AND entity_local_id = ? AND op = 'update')
            """, arguments: [conflict.entityType, localId]) ?? false
        // A queued update reads the row when it runs, so it already sends the merged object.
        if !queued { try connection.enqueue(entity, localId: localId, operation: .update, payload: payload, at: now) }
    }

    /// Use theirs for a project or label: every field from the server's copy, the edit cleared, its queued update
    /// dropped. A pending delete is left to run.
    static func overwriteFromRemote(_ connection: Database, conflict: ConflictRecord, now: String) throws {
        let localId = conflict.entityLocalId
        guard let remote = (try? jsonObject(conflict.remoteSnapshot)) ?? nil else { return }
        let updated = remote["updated"] as? String ?? now
        if conflict.entityType == "project" {
            let parent = try remoteParentLocalId(connection, remote: remote, localId: localId)
            try connection.execute(sql: """
                UPDATE projects SET title = ?, description = ?, hex_color = ?, is_archived = ?, is_favorite = ?,
                       position = ?, identifier = ?, parent_local_id = ?, updated_at = ?, synced_at = ?,
                       last_synced = ?, dirty = 0
                 WHERE local_id = ? AND deleted = 0
                """, arguments: [
                    remote["title"] as? String ?? "", remote["description"] as? String, remote["hex_color"] as? String,
                    remote["is_archived"] as? Bool ?? false, remote["is_favorite"] as? Bool ?? false,
                    (remote["position"] as? NSNumber)?.doubleValue, remote["identifier"] as? String, parent,
                    updated, now, conflict.remoteSnapshot, localId
                ])
        } else {
            try connection.execute(sql: """
                UPDATE labels SET title = ?, description = ?, hex_color = ?, updated_at = ?, synced_at = ?,
                       last_synced = ?, dirty = 0
                 WHERE local_id = ? AND deleted = 0
                """, arguments: [
                    remote["title"] as? String ?? "", remote["description"] as? String, remote["hex_color"] as? String,
                    updated, now, conflict.remoteSnapshot, localId
                ])
        }
        try connection.execute(
            sql: "DELETE FROM outbox WHERE entity_type = ? AND entity_local_id = ? AND op = 'update'",
            arguments: [conflict.entityType, localId]
        )
    }

    /// The local id of the server copy's parent: nil for none, the current parent when the server's is not synced here.
    private static func remoteParentLocalId(_ connection: Database, remote: [String: Any], localId: String) throws -> String? {
        guard let parentId = jsonInt(remote["parent_project_id"]), parentId > 0 else { return nil }
        if let parent = try String.fetchOne(connection, sql: "SELECT local_id FROM projects WHERE server_id = ?", arguments: [parentId]) {
            return parent
        }
        return try String.fetchOne(connection, sql: "SELECT parent_local_id FROM projects WHERE local_id = ?", arguments: [localId])
    }

    /// Per-field rows for the conflict sheet, with "Yours" as the row is on this device now. `ConflictRecord.diff`
    /// shows the last-synced snapshot on that side, which for a project or label is not the edit. Parents show by
    /// title. Tasks get `ConflictRecord.diff` unchanged.
    public func conflictDiff(_ conflict: ConflictRecord) throws -> [ConflictFieldDiff] {
        guard CriaStore.conflictFields(conflict.entityType) != nil else { return conflict.diff }
        return try database.writer.read { connection in
            guard let local = try CriaStore.localConflictValues(
                connection, entityType: conflict.entityType, localId: conflict.entityLocalId
            ) else { return conflict.diff }
            let remote = ((try? CriaStore.jsonObject(conflict.remoteSnapshot)) ?? nil) ?? [:]
            func render(_ field: String, _ value: Any?) throws -> String {
                guard field == "parent_project_id" else { return renderConflictValue(value) }
                if let parentLocalId = value as? String {
                    return try String.fetchOne(
                        connection, sql: "SELECT title FROM projects WHERE local_id = ?", arguments: [parentLocalId]
                    ) ?? "None"
                }
                guard let id = CriaStore.jsonInt(value), id > 0 else { return "None" }
                return try String.fetchOne(connection, sql: "SELECT title FROM projects WHERE server_id = ?", arguments: [id])
                    ?? "Project \(id)"
            }
            return try conflict.diff.map { row in
                ConflictFieldDiff(field: row.field, label: row.label, local: try render(row.field, local[row.field]),
                                  remote: try render(row.field, remote[row.field]))
            }
        }
    }
}
