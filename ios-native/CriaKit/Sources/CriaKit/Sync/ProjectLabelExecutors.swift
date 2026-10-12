import Foundation
import GRDB

/// Project ops. Ported from `src/sync/push/project.ts`. Unlike the TypeScript body, `is_favorite` is always sent:
/// Vikunja's project POST replaces the whole object (AGENTS.md), so omitting it would un-favourite on the server.
public struct ProjectExecutor: OutboxExecutor {
    public init() {}

    private static let select = """
        SELECT \(CriaStore.projectColumns), deleted, last_synced FROM projects WHERE local_id = ?
        """

    func body(_ project: ProjectRecord, store: CriaStore) throws -> JSONBody {
        var body: JSONBody = [
            "title": .string(project.title),
            "is_archived": .bool(project.isArchived),
            "is_favorite": .bool(project.isFavorite)
        ]
        if let description = project.description { body["description"] = .string(description) }
        if let color = stripHash(project.hexColor) { body["hex_color"] = .string(color) }
        if let position = project.position { body["position"] = .number(position) }
        if let identifier = project.identifier { body["identifier"] = .string(identifier) }
        if let parent = project.parentLocalId, let parentServerId = try store.pushInt(
            "SELECT server_id FROM projects WHERE local_id = ?", parent
        ) {
            body["parent_project_id"] = .number(Double(parentServerId))
        }
        return body
    }

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let localId = op.entityLocalId
        guard let row = try store.pushRow(Self.select, localId) else { return }
        let project = ProjectRecord(row: row)
        let deleted: Bool = row["deleted"]
        let lastSynced: String? = row["last_synced"]

        switch op.op {
        case "create":
            if deleted {
                try store.removeProjectLocally(localId: localId)
                return
            }
            if project.serverId != nil { return }
            if let cached = cachedCreateResponse(op.payload) {
                try store.markCreated(table: "projects", localId: localId, serverId: cached, updatedAt: nil,
                                      onlyIfUnchangedSince: nil, announcing: .projects)
                return
            }
            let created = try await api.createProject(try body(project, store: store))
            try store.cacheCreateResponse(opId: op.id, payload: op.payload, serverId: created.id)
            try store.markCreated(table: "projects", localId: localId, serverId: created.id, updatedAt: created.updated,
                                  onlyIfUnchangedSince: project.updatedAt, announcing: .projects)
        case "update":
            if deleted { return }
            guard let serverId = project.serverId else { throw ApiError.blocked("Cannot update a project without server id") }
            if try store.hasUnresolvedConflict(entityType: "project", localId: localId) { throw ApiError.conflictBlocked }
            if let lastSynced, let current = try? await api.send(.get, "/projects/\(serverId)"), current.isSuccess,
               try store.checkDivergence(lastSynced: lastSynced, serverPayload: current.data,
                                         fields: ["title", "description"], entityType: "project", localId: localId) {
                return
            }
            let updated = try await api.updateProject(id: serverId, try body(project, store: store))
            try store.markPushed(table: "projects", localId: localId, updatedAt: updated.updated,
                                 onlyIfUnchangedSince: project.updatedAt, announcing: .projects)
        case "delete":
            if let serverId = project.serverId {
                try await api.performIgnoring404(.delete, "/projects/\(serverId)")
            }
            try store.removeProjectLocally(localId: localId)
        default:
            return
        }
    }
}

extension CriaStore {
    func removeProjectLocally(localId: String) throws {
        try userWrite(announcing: [.projects, .tasks]) { connection in
            // Prune relations before the tasks: the subquery needs those rows to still exist.
            try connection.execute(sql: """
                DELETE FROM task_relations
                 WHERE task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)
                    OR other_task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)
                """, arguments: [localId, localId])
            try CriaStore.deleteCommentsOfProject(connection, projectLocalId: localId)
            try connection.execute(sql: "DELETE FROM tasks WHERE project_local_id = ?", arguments: [localId])
            try connection.execute(sql: "DELETE FROM projects WHERE local_id = ?", arguments: [localId])
        }
    }
}

/// Label ops. Ported from `src/sync/push/label.ts`.
public struct LabelExecutor: OutboxExecutor {
    public init() {}

    private static let select = """
        SELECT \(CriaStore.labelColumns), deleted, last_synced FROM labels WHERE local_id = ?
        """

    func body(_ label: LabelRecord) -> JSONBody {
        var body: JSONBody = ["title": .string(label.title)]
        if let description = label.description { body["description"] = .string(description) }
        if let color = stripHash(label.hexColor) { body["hex_color"] = .string(color) }
        return body
    }

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let localId = op.entityLocalId
        guard let row = try store.pushRow(Self.select, localId) else { return }
        let label = LabelRecord(row: row)
        let deleted: Bool = row["deleted"]
        let lastSynced: String? = row["last_synced"]

        switch op.op {
        case "create":
            if deleted {
                try store.dropRow(table: "labels", localId: localId, announcing: [.labels])
                return
            }
            if label.serverId != nil { return }
            if let cached = cachedCreateResponse(op.payload) {
                try store.markCreated(table: "labels", localId: localId, serverId: cached, updatedAt: nil,
                                      onlyIfUnchangedSince: nil, announcing: .labels)
                return
            }
            let created = try await api.createLabel(body(label))
            try store.cacheCreateResponse(opId: op.id, payload: op.payload, serverId: created.id)
            try store.markCreated(table: "labels", localId: localId, serverId: created.id, updatedAt: created.updated,
                                  onlyIfUnchangedSince: label.updatedAt, announcing: .labels)
        case "update":
            if deleted { return }
            guard let serverId = label.serverId else { throw ApiError.blocked("Cannot update a label without server id") }
            if try store.hasUnresolvedConflict(entityType: "label", localId: localId) { throw ApiError.conflictBlocked }
            if let lastSynced, let current = try? await api.send(.get, "/labels/\(serverId)"), current.isSuccess,
               try store.checkDivergence(lastSynced: lastSynced, serverPayload: current.data,
                                         fields: ["title", "description"], entityType: "label", localId: localId) {
                return
            }
            let updated = try await api.updateLabel(id: serverId, body(label))
            try store.markPushed(table: "labels", localId: localId, updatedAt: updated.updated,
                                 onlyIfUnchangedSince: label.updatedAt, announcing: .labels)
        case "delete":
            if let serverId = label.serverId {
                try await api.performIgnoring404(.delete, "/labels/\(serverId)")
            }
            try store.dropRow(table: "labels", localId: localId, announcing: [.labels, .tasks],
                              also: [("DELETE FROM task_labels WHERE label_local_id = ?", [localId])])
        default:
            return
        }
    }
}
