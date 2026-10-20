import Foundation
import GRDB

/// A field edit that can keep the stored value, or set a new one (including clearing it with nil).
public enum FieldChange<Value: Sendable>: Sendable {
    case keep
    case set(Value?)
}

public struct ProjectInput: Sendable {
    public var title: String
    public var description: String?
    public var parentLocalId: String?
    public var hexColor: String?
    /// Task-index prefix; trimmed and uppercased on save, and checked against the server's rules (see `ProjectIdentifier`).
    public var identifier: String?

    public init(
        title: String, description: String? = nil, parentLocalId: String? = nil, hexColor: String? = nil, identifier: String? = nil
    ) {
        self.title = title
        self.description = description
        self.parentLocalId = parentLocalId
        self.hexColor = hexColor
        self.identifier = identifier
    }
}

public struct ProjectPatch: Sendable {
    public var title: String?
    public var description: FieldChange<String> = .keep
    public var hexColor: FieldChange<String> = .keep
    public var parentLocalId: FieldChange<String> = .keep
    public var identifier: FieldChange<String> = .keep
    public var isArchived: Bool?

    public init(title: String? = nil, isArchived: Bool? = nil) {
        self.title = title
        self.isArchived = isArchived
    }
}

extension CriaStore {
    static func fetchProject(_ connection: Database, localId: String) throws -> ProjectRecord? {
        try Row.fetchOne(
            connection,
            sql: "SELECT \(projectColumns) FROM projects WHERE local_id = ? AND deleted = 0",
            arguments: [localId]
        ).map(ProjectRecord.init(row:))
    }

    public func project(localId: String) throws -> ProjectRecord? {
        try database.writer.read { try CriaStore.fetchProject($0, localId: localId) }
    }

    static func projectPayload(_ record: ProjectRecord) -> [String: Any] {
        [
            "title": record.title,
            "description": jsonNullable(record.description),
            "hex_color": jsonNullable(record.hexColor),
            "identifier": jsonNullable(record.identifier),
            "parent_local_id": jsonNullable(record.parentLocalId),
            "is_archived": record.isArchived,
            "is_favorite": record.isFavorite
        ]
    }

    /// User mutation: new project at the end of the list, queued for create. Throws `ProjectValidationError` for a bad
    /// identifier or an archived parent, writing nothing.
    @discardableResult
    public func createProject(_ input: ProjectInput) throws -> ProjectRecord {
        try userWrite(announcing: [.projects, .outbox]) { connection in
            try CriaStore.validateProject(
                connection, existing: nil, identifier: .set(input.identifier),
                parent: .set(input.parentLocalId), unarchiving: false
            )
            let identifier = ProjectIdentifier.normalised(input.identifier)
            let localId = UUID().uuidString
            let now = isoNow()
            let maxPosition = try Double.fetchOne(
                connection, sql: "SELECT MAX(position) FROM projects WHERE deleted = 0"
            ) ?? 0
            try connection.execute(sql: """
                INSERT INTO projects (local_id, server_id, title, description, parent_local_id, hex_color,
                       is_archived, is_favorite, position, updated_at, identifier, dirty, deleted)
                VALUES (?, NULL, ?, ?, ?, ?, 0, 0, ?, ?, ?, 1, 0)
                """, arguments: [
                    localId, input.title, input.description, input.parentLocalId, input.hexColor,
                    maxPosition + 1024, now, identifier
                ])
            guard let record = try CriaStore.fetchProject(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            try connection.enqueue(.project, localId: localId, operation: .create, payload: CriaStore.projectPayload(record), at: now)
            return record
        }
    }

    /// User mutation: edits the given fields and queues a full-object update (Vikunja's POST replaces everything).
    /// Throws `ProjectValidationError` (identifier too long or taken, parent is itself, a descendant or archived)
    /// before anything is written.
    @discardableResult
    public func updateProject(localId: String, patch: ProjectPatch) throws -> ProjectRecord {
        try userWrite(announcing: [.projects, .outbox]) { connection in
            guard let existing = try CriaStore.fetchProject(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            try CriaStore.validateProject(
                connection, existing: existing, identifier: patch.identifier, parent: patch.parentLocalId,
                unarchiving: existing.isArchived && patch.isArchived == false
            )
            var identifier = patch.identifier
            if case .set(let raw) = identifier { identifier = .set(ProjectIdentifier.normalised(raw)) }
            let now = isoNow()
            var assignments = ["dirty = 1", "updated_at = ?"]
            var arguments: [(any DatabaseValueConvertible)?] = [now]
            if let title = patch.title {
                assignments.append("title = ?")
                arguments.append(title)
            }
            if let archived = patch.isArchived {
                assignments.append("is_archived = ?")
                arguments.append(archived)
            }
            for (column, change) in [
                ("description", patch.description), ("hex_color", patch.hexColor), ("parent_local_id", patch.parentLocalId),
                ("identifier", identifier)
            ] {
                if case .set(let value) = change {
                    assignments.append("\(column) = ?")
                    arguments.append(value)
                }
            }
            arguments.append(localId)
            try connection.execute(
                sql: "UPDATE projects SET \(assignments.joined(separator: ", ")) WHERE local_id = ? AND deleted = 0",
                arguments: StatementArguments(arguments)
            )
            guard let record = try CriaStore.fetchProject(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            try connection.enqueue(.project, localId: localId, operation: .update, payload: CriaStore.projectPayload(record), at: now)
            return record
        }
    }

    /// User mutation: archives or unarchives a project through `updateProject` (outbox, change bus). Unarchiving
    /// under an archived parent throws `ProjectValidationError.parentArchived`.
    @discardableResult
    public func setProjectArchived(localId: String, archived: Bool) throws -> ProjectRecord {
        try updateProject(localId: localId, patch: ProjectPatch(isArchived: archived))
    }

    /// User mutation: soft-deletes the project and its tasks locally. The server's DELETE takes the subtree with it.
    public func deleteProject(localId: String) throws {
        try userWrite(announcing: [.projects, .tasks, .outbox]) { connection in
            let now = isoNow()
            let exists = try Bool.fetchOne(
                connection, sql: "SELECT EXISTS(SELECT 1 FROM projects WHERE local_id = ? AND deleted = 0)", arguments: [localId]
            ) ?? false
            guard exists else { return }
            try connection.execute(
                sql: "UPDATE projects SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?", arguments: [now, localId]
            )
            try connection.execute(
                sql: "UPDATE tasks SET deleted = 1, updated_at = ? WHERE project_local_id = ? AND deleted = 0",
                arguments: [now, localId]
            )
            try connection.enqueue(.project, localId: localId, operation: .delete, payload: [:], at: now)
        }
    }
}
