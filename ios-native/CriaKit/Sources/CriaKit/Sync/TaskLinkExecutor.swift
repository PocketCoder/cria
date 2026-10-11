import Foundation
import GRDB

/// `task_label`, `task_assignee` and `task_relation` ops. Ported from `executeTaskLinkOp`.
/// Payload keys are snake_case (`task_local_id`, `label_local_id`, `user_server_id`, `other_task_local_id`,
/// `other_task_server_id`, `kind`); camelCase is accepted too. `create` or `add` adds, `delete` or `remove` removes.
public struct TaskLinkExecutor: OutboxExecutor {
    public init() {}

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let payload = op.payloadObject
        let adding = op.op == "create" || op.op == "add"
        let removing = op.op == "delete" || op.op == "remove"
        let taskLocalId = payload.string("task_local_id", "taskLocalId") ?? String(op.entityLocalId.split(separator: ":").first ?? "")

        guard let taskServerId = try store.pushTaskServerId(localId: taskLocalId) else {
            // The task was deleted before this op ran (a never-synced task is dropped with its create): nothing to do.
            if try !store.pushRowExists(table: "tasks", localId: taskLocalId) { return }
            throw ApiError.blocked("\(op.entityType): task has no server id")
        }
        switch op.entityType {
        case "task_label":
            let labelLocalId = payload.string("label_local_id", "labelLocalId") ?? ""
            guard let labelServerId = try store.pushLabelServerId(localId: labelLocalId) else {
                if try !store.pushRowExists(table: "labels", localId: labelLocalId) { return }
                throw ApiError.blocked("task_label: label has no server id")
            }
            if adding {
                try await api.addLabel(taskId: taskServerId, labelId: labelServerId)
            } else if removing {
                try await api.performIgnoring404(.delete, "/tasks/\(taskServerId)/labels/\(labelServerId)")
            }
        case "task_assignee":
            // A quick-add `@name` has no id yet: look the user up now, when there is a connection. An unknown name, or
            // one that matches nobody exactly, is dropped rather than retried forever.
            var resolved = payload.int("user_server_id", "userServerId")
            if resolved == nil, let name = payload.string("username") {
                resolved = try await Self.userId(forUsername: name, api: api)
            }
            guard let userId = resolved else { return }
            if adding {
                try await api.addAssignee(taskId: taskServerId, userId: userId)
            } else if removing {
                try await api.performIgnoring404(.delete, "/tasks/\(taskServerId)/assignees/\(userId)")
            }
        case "task_relation":
            try await relation(op, payload, taskServerId, adding, removing, api, store)
        default:
            return
        }
    }

    /// The id of the user whose username is exactly `name` (any case), or nil.
    static func userId(forUsername name: String, api: ApiClient) async throws -> Int? {
        let wanted = name.trimmingCharacters(in: CharacterSet(charactersIn: "@ ")).lowercased()
        guard !wanted.isEmpty else { return nil }
        let matches = try await api.searchUsers(wanted)
        return matches.first { $0.username.lowercased() == wanted }?.id
    }

    private func relation(_ op: OutboxRow, _ payload: [String: Any], _ taskServerId: Int, _ adding: Bool, _ removing: Bool,
                          _ api: ApiClient, _ store: CriaStore) async throws {
        let kind = payload.string("kind") ?? ""
        // A remove may carry only the peer's server id (it had not synced when the row was mirrored).
        var otherServerId = payload.int("other_task_server_id", "otherTaskServerId")
        if otherServerId == nil, let otherLocal = payload.string("other_task_local_id", "otherTaskLocalId") {
            otherServerId = try store.pushTaskServerId(localId: otherLocal)
        }
        guard let otherServerId else { throw ApiError.blocked("task_relation: peer task has no server id") }
        if adding {
            try await api.addRelation(taskId: taskServerId, [
                "task_id": .number(Double(taskServerId)),
                "other_task_id": .number(Double(otherServerId)),
                "relation_kind": .string(kind)
            ])
        } else if removing {
            try await api.performIgnoring404(.delete, "/tasks/\(taskServerId)/relations/\(kind)/\(otherServerId)", body: JSONBody())
        }
    }
}

extension CriaStore {
    func pushTaskServerId(localId: String) throws -> Int? {
        try database.writer.read { try Int.fetchOne($0, sql: "SELECT server_id FROM tasks WHERE local_id = ?", arguments: [localId]) }
    }

    func pushLabelServerId(localId: String) throws -> Int? {
        try database.writer.read { try Int.fetchOne($0, sql: "SELECT server_id FROM labels WHERE local_id = ?", arguments: [localId]) }
    }
}
