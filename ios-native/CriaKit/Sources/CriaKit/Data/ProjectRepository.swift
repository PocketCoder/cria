import Foundation
import GRDB

public struct ProjectRecord: Equatable, Sendable {
    public let localId: String
    public let serverId: Int?
    public let title: String
    public let description: String?
    public let parentLocalId: String?
    public let hexColor: String?
    public let isArchived: Bool
    public let isFavorite: Bool
    public let position: Double?
    public let updatedAt: String

    init(row: Row) {
        localId = row["local_id"]
        serverId = row["server_id"]
        title = row["title"]
        description = row["description"]
        parentLocalId = row["parent_local_id"]
        hexColor = row["hex_color"]
        isArchived = row["is_archived"]
        isFavorite = row["is_favorite"]
        position = row["position"]
        updatedAt = row["updated_at"]
    }
}

extension CriaStore {
    static let projectColumns = """
        local_id, server_id, title, description, parent_local_id, hex_color, \
        is_archived, is_favorite, position, updated_at
        """

    public func projects() throws -> [ProjectRecord] {
        try database.writer.read { db in
            try Row.fetchAll(db, sql: """
                SELECT \(CriaStore.projectColumns) FROM projects
                 WHERE deleted = 0
                 ORDER BY position IS NULL, position ASC, title COLLATE NOCASE ASC
                """).map(ProjectRecord.init(row:))
        }
    }

    /// Silent server merge. Never publishes a change. A row with a pending local edit is left untouched.
    /// Returns the local id, or nil when the row is pending a local delete.
    @discardableResult
    public func upsertProjectFromServer(_ payload: ProjectResponse, rawJSON: String) throws -> String? {
        try database.writer.write { db -> String? in
            let parentLocalId: String? = try payload.parentProjectId.flatMap { parentId in
                try String.fetchOne(db, sql: "SELECT local_id FROM projects WHERE server_id = ?", arguments: [parentId])
            }
            let now = isoNow()
            let existing = try Row.fetchOne(
                db,
                sql: "SELECT local_id, dirty, deleted FROM projects WHERE server_id = ?",
                arguments: [payload.id]
            )
            if let existing {
                let localId: String = existing["local_id"]
                let dirty: Bool = existing["dirty"]
                let deleted: Bool = existing["deleted"]
                if dirty {
                    return deleted ? nil : localId
                }
                try db.execute(sql: """
                    UPDATE projects SET title = ?, description = ?, parent_local_id = ?, hex_color = ?,
                           is_archived = ?, is_favorite = ?, position = ?, updated_at = ?,
                           synced_at = ?, last_synced = ?, dirty = 0, deleted = 0
                     WHERE local_id = ?
                    """, arguments: [
                        payload.title, payload.description, parentLocalId, payload.hexColor,
                        payload.isArchived ?? false, payload.isFavorite ?? false, payload.position,
                        payload.updated ?? now, now, rawJSON, localId,
                    ])
                return localId
            }
            let localId = UUID().uuidString
            try db.execute(sql: """
                INSERT INTO projects (local_id, server_id, title, description, parent_local_id, hex_color,
                       is_archived, is_favorite, position, updated_at, synced_at, last_synced, dirty, deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                """, arguments: [
                    localId, payload.id, payload.title, payload.description, parentLocalId, payload.hexColor,
                    payload.isArchived ?? false, payload.isFavorite ?? false, payload.position,
                    payload.updated ?? now, now, rawJSON,
                ])
            return localId
        }
    }

    /// User mutation: marks the project as a favourite (or not) and queues an update.
    public func setProjectFavorite(localId: String, isFavorite: Bool) throws {
        try userWrite(announcing: [.projects, .outbox]) { db in
            let now = isoNow()
            try db.execute(
                sql: "UPDATE projects SET is_favorite = ?, dirty = 1, updated_at = ? WHERE local_id = ? AND deleted = 0",
                arguments: [isFavorite, now, localId]
            )
            // Vikunja's project POST replaces the whole object, so queue every field, not just the flag.
            let row = try Row.fetchOne(db, sql: "SELECT \(CriaStore.projectColumns) FROM projects WHERE local_id = ?", arguments: [localId])
            guard let row else { throw CriaStoreError.notFound(localId) }
            let record = ProjectRecord(row: row)
            try db.enqueue(.project, localId: localId, op: .update, payload: [
                "title": record.title,
                "description": jsonNullable(record.description),
                "hex_color": jsonNullable(record.hexColor),
                "is_archived": record.isArchived,
                "is_favorite": record.isFavorite,
            ], at: now)
        }
    }
}
