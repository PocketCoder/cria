import Foundation
import GRDB

/// Task comment ops. Ported from `src/sync/push/comment.ts`. Server id 0 means the create has not been pushed.
public struct CommentExecutor: OutboxExecutor {
    public init() {}

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let localId = op.entityLocalId
        guard let row = try store.pushRow("""
            SELECT local_id, server_id, task_local_id, comment, updated_at, deleted FROM task_comments WHERE local_id = ?
            """, localId) else { return }
        let serverId: Int = row["server_id"]
        let taskLocalId: String = row["task_local_id"]
        let storedComment: String = row["comment"]
        let updatedAt: String = row["updated_at"]
        let deleted: Bool = row["deleted"]
        // Never send an inline-image placeholder whose upload has already landed.
        let comment = try store.resolveUploadedPendingRefs(storedComment, serverBase: await api.serverBase() ?? "") ?? storedComment
        guard let taskServerId = try store.pushTaskServerId(localId: taskLocalId) else {
            throw ApiError.blocked("task_comment: parent task not synced yet")
        }

        switch op.op {
        case "create":
            if deleted {
                try store.dropRow(table: "task_comments", localId: localId, announcing: [.comments])
                return
            }
            if serverId != 0 { return }
            if let cached = cachedCreateResponse(op.payload) {
                try store.markCommentSynced(localId: localId, serverId: cached, updatedAt: nil, onlyIfUnchangedSince: nil)
                return
            }
            let created = try await api.createComment(taskId: taskServerId, ["comment": .string(comment)])
            try store.cacheCreateResponse(opId: op.id, payload: op.payload, serverId: created.id)
            try store.markCommentSynced(localId: localId, serverId: created.id, updatedAt: nil, onlyIfUnchangedSince: nil)
        case "update":
            if serverId == 0 { throw ApiError.blocked("Cannot update a comment without server id") }
            let updated = try await api.updateComment(taskId: taskServerId, id: serverId, ["comment": .string(comment)])
            try store.markCommentSynced(localId: localId, serverId: nil, updatedAt: updated.updated, onlyIfUnchangedSince: updatedAt)
        case "delete":
            if serverId != 0 {
                try await api.performIgnoring404(.delete, "/tasks/\(taskServerId)/comments/\(serverId)")
            }
            try store.dropRow(table: "task_comments", localId: localId, announcing: [.comments])
        default:
            return
        }
    }
}

extension CriaStore {
    func markCommentSynced(localId: String, serverId: Int?, updatedAt: String?, onlyIfUnchangedSince: String?) throws {
        let now = isoNow()
        try userWrite(announcing: [.comments]) { connection in
            var assignments = ["synced_at = ?", "dirty = 0"]
            var arguments: [(any DatabaseValueConvertible)?] = [now]
            if let serverId {
                assignments.append("server_id = ?")
                arguments.append(serverId)
            }
            if let updatedAt {
                assignments.append("updated_at = ?")
                arguments.append(updatedAt)
            }
            var sql = "UPDATE task_comments SET \(assignments.joined(separator: ", ")) WHERE local_id = ?"
            arguments.append(localId)
            if let onlyIfUnchangedSince {
                sql += " AND updated_at = ?"
                arguments.append(onlyIfUnchangedSince)
            }
            try connection.execute(sql: sql, arguments: StatementArguments(arguments))
        }
    }
}

public extension OutboxDrainer {
    /// Registers every entity executor. Attachment uploads join in S-37.
    func registerStandardExecutors() {
        register("task", TaskExecutor())
        for type in ["task_label", "task_assignee", "task_relation"] { register(type, TaskLinkExecutor()) }
        register("project", ProjectExecutor())
        register("label", LabelExecutor())
        register("view", ViewExecutor())
        register("bucket", BucketExecutor())
        register("task_bucket", TaskBucketExecutor())
        register("task_position", TaskPositionExecutor())
        register("task_comment", CommentExecutor())
    }
}
