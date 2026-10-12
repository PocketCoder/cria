import Foundation
import GRDB

/// Open and done task counts for one project.
public struct ProjectTaskCounts: Equatable, Sendable {
    public let open: Int
    public let done: Int

    public init(open: Int, done: Int) {
        self.open = open
        self.done = done
    }
}

/// What only the server knows about a project: its owner and when it was created. Ported from `getProjectInfo` in
/// `src/api/projects.ts`.
public struct ProjectServerInfo: Decodable, Equatable, Sendable {
    public let ownerName: String?
    public let created: String?

    private struct Owner: Decodable {
        let name: String?
        let username: String?
    }

    enum CodingKeys: String, CodingKey {
        case owner, created
    }

    public init(ownerName: String?, created: String?) {
        self.ownerName = ownerName
        self.created = created
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let owner = try container.decodeIfPresent(Owner.self, forKey: .owner)
        let name = [owner?.name, owner?.username].compactMap { $0 }.first { !$0.isEmpty }
        let created = try container.decodeIfPresent(String.self, forKey: .created)
        self.init(ownerName: name, created: Self.usable(created))
    }

    /// Vikunja's "no date" sentinel (`0001-01-01...`) means unset.
    static func usable(_ created: String?) -> String? {
        guard let created, !created.isEmpty, !created.hasPrefix("0001-") else { return nil }
        return created
    }
}

/// Why a project action that needs the server could not start.
public struct ProjectOnlineError: Error, CustomStringConvertible, Equatable, Sendable {
    public let description: String

    public static let notSynced = ProjectOnlineError(
        description: "This project has not synced yet. Try again after the next sync."
    )
}

extension CriaStore {
    public func taskCounts(forProject projectLocalId: String) throws -> ProjectTaskCounts {
        try database.writer.read { connection in
            let row = try Row.fetchOne(connection, sql: """
                SELECT COALESCE(SUM(done = 0), 0) AS open, COALESCE(SUM(done = 1), 0) AS finished FROM tasks
                 WHERE project_local_id = ? AND deleted = 0
                """, arguments: [projectLocalId])
            return ProjectTaskCounts(open: row?["open"] ?? 0, done: row?["finished"] ?? 0)
        }
    }

    /// Assignees of every live task in a project, by task local id. One read instead of one per row.
    public func assigneesByTask(projectLocalId: String) throws -> [String: [AssigneeRecord]] {
        try database.writer.read { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT a.task_local_id, a.user_server_id, a.username FROM task_assignees a
                  JOIN tasks t ON t.local_id = a.task_local_id
                 WHERE t.project_local_id = ? AND t.deleted = 0 AND a.deleted = 0
                 ORDER BY a.username COLLATE NOCASE ASC, a.user_server_id ASC
                """, arguments: [projectLocalId])
            var byTask: [String: [AssigneeRecord]] = [:]
            for row in rows {
                let taskId: String = row["task_local_id"]
                let userId: Int = row["user_server_id"]
                byTask[taskId, default: []].append(AssigneeRecord(
                    userId: userId, username: row["username"], displayName: UserNameDirectory.shared.name(for: userId)
                ))
            }
            return byTask
        }
    }
}

/// The reply to a duplicate: the copy's id is all the app needs.
private struct DuplicateReply: Decodable {
    let duplicatedProject: Copy?

    struct Copy: Decodable { let id: Int }

    enum CodingKeys: String, CodingKey { case duplicatedProject = "duplicated_project" }
}

extension ApiClient {
    func projectInfo(id: Int) async throws -> ProjectServerInfo { try await get("/projects/\(id)") }

    /// `PUT /projects/{id}/duplicate`: the server copies tasks, views, labels, comments, attachments, relations,
    /// backgrounds and sharing. `parentId` is the copy's parent (0 for the top level). Returns the copy's id.
    func duplicateProject(id: Int, parentId: Int) async throws -> Int {
        let body: JSONBody = ["parent_project_id": .number(Double(parentId))]
        let reply: DuplicateReply = try await put("/projects/\(id)/duplicate", body: body)
        guard let copy = reply.duplicatedProject else {
            throw ApiError(status: 0, code: nil, message: "The server did not return the copy.", retryable: false)
        }
        return copy.id
    }
}

extension AppServices {
    /// Owner and creation date from the server. Nil offline or when the project has not synced.
    public func projectInfo(serverId: Int) async -> ProjectServerInfo? {
        guard serverId > 0 else { return nil }
        return try? await api.projectInfo(id: serverId)
    }

    /// Duplicates a project on the server, then pulls so the copy appears. Online only; the copy goes under the same
    /// parent as the original. Throws `ProjectOnlineError.notSynced` for a project the server has not seen yet.
    public func duplicateProject(localId: String) async throws {
        guard let project = try store.project(localId: localId), let serverId = project.serverId, serverId > 0 else {
            throw ProjectOnlineError.notSynced
        }
        let parentServerId = try project.parentLocalId.flatMap { try store.project(localId: $0)?.serverId } ?? 0
        _ = try await api.duplicateProject(id: serverId, parentId: max(parentServerId, 0))
        await refresh()
    }
}
