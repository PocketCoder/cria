import Foundation
import GRDB

/// A task attachment row, either mirrored from the server or a pending upload.
public struct AttachmentRecord: Equatable, Sendable {
    public let localId: String
    /// Nil while the upload is still queued.
    public let serverId: Int?
    public let fileId: Int?
    public let fileName: String
    public let fileSize: Int?
    public let mime: String?
    public let createdAt: String?
    /// Queued for upload; the bytes are in the local side-store.
    public let pending: Bool
    /// Pending, but its upload op has left the outbox without succeeding, so nothing will upload it on its own.
    public let uploadFailed: Bool

    init(row: Row) {
        let name: String? = row["file_name"]
        let queued: Bool = row["queued"]
        let isPending: Bool = row["pending"]
        localId = row["local_id"]
        serverId = row["server_id"]
        fileId = row["file_id"]
        fileName = name ?? "attachment"
        fileSize = row["file_size"]
        mime = row["mime"]
        createdAt = row["created_at"]
        pending = isPending
        uploadFailed = isPending && !queued
    }
}

/// Outbox payload of a queued upload. The bytes stay in the side-store under `bytesPath`.
public struct AttachmentUploadPayload: Equatable, Sendable {
    public let taskLocalId: String
    public let attachmentLocalId: String
    public let fileName: String
    public let mime: String
    public let size: Int
    public let bytesPath: String

    public init(taskLocalId: String, attachmentLocalId: String, fileName: String, mime: String, size: Int, bytesPath: String) {
        self.taskLocalId = taskLocalId
        self.attachmentLocalId = attachmentLocalId
        self.fileName = fileName
        self.mime = mime
        self.size = size
        self.bytesPath = bytesPath
    }

    var outboxPayload: [String: Any] {
        [
            "taskLocalId": taskLocalId,
            "attachmentLocalId": attachmentLocalId,
            "fileName": fileName,
            "mime": mime,
            "size": size,
            "bytesPath": bytesPath
        ]
    }
}

/// One attachment looked up by local id. Feeds the resolver for `cria://pending/{localId}` references.
public struct AttachmentLookup: Equatable, Sendable {
    public let localId: String
    public let taskLocalId: String
    public let serverId: Int?
    /// The owning task's server id, if it has synced.
    public let taskServerId: Int?
    public let mime: String?
    public let pending: Bool
    public let bytesPath: String?

    init(row: Row) {
        localId = row["local_id"]
        taskLocalId = row["task_local_id"]
        serverId = row["server_id"]
        taskServerId = row["task_server_id"]
        mime = row["mime"]
        pending = row["pending"]
        bytesPath = row["bytes_path"]
    }
}

/// An uploaded attachment with the server ids needed to build its URL.
public struct UploadedAttachmentRef: Equatable, Sendable {
    public let localId: String
    public let serverId: Int
    public let taskServerId: Int
}

/// Which follow-up announcements a rewrite of descriptions and comments needs.
struct AttachmentRewriteOutcome: Sendable {
    var commentsChanged = false
    var queued = false
}

/// How a rewritten comment is saved.
enum CommentRewriteMode {
    /// The row already has an op queued that reads it, so only the text changes.
    case alreadyDirty
    /// Saved the way a user edit is: dirty, plus an update op.
    case queueUpdate
    /// Dirty, but no op: the comment has not synced, and its queued create reads the row.
    case saveOnly
}

extension CriaStore {
    // MARK: Reads

    public func attachments(forTask taskLocalId: String) throws -> [AttachmentRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT a.local_id, a.server_id, a.file_id, a.file_name, a.file_size, a.mime, a.created_at, a.pending,
                       EXISTS (SELECT 1 FROM outbox o
                                WHERE o.entity_type = 'task_attachment' AND o.entity_local_id = a.local_id) AS queued
                  FROM task_attachments a
                 WHERE a.task_local_id = ?
                 ORDER BY a.created_at ASC, a.server_id ASC
                """, arguments: [taskLocalId]).map(AttachmentRecord.init(row:))
        }
    }

    public func attachment(localId: String) throws -> AttachmentLookup? {
        try database.writer.read { connection in
            try Row.fetchOne(connection, sql: """
                SELECT a.local_id, a.task_local_id, a.server_id, t.server_id AS task_server_id,
                       a.mime, a.pending, a.bytes_path
                  FROM task_attachments a
                  LEFT JOIN tasks t ON t.local_id = a.task_local_id
                 WHERE a.local_id = ?
                """, arguments: [localId]).map(AttachmentLookup.init(row:))
        }
    }

    /// Of `localIds`, the attachments that have uploaded and whose task has synced.
    public func uploadedAttachments(localIds: [String]) throws -> [UploadedAttachmentRef] {
        guard !localIds.isEmpty else { return [] }
        return try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT a.local_id, a.server_id, t.server_id AS task_server_id
                  FROM task_attachments a
                  JOIN tasks t ON t.local_id = a.task_local_id
                 WHERE a.local_id IN (\(sqlPlaceholders(localIds.count)))
                   AND a.server_id IS NOT NULL AND t.server_id IS NOT NULL
                """, arguments: sqlArguments(localIds)).map { row in
                UploadedAttachmentRef(localId: row["local_id"], serverId: row["server_id"], taskServerId: row["task_server_id"])
            }
        }
    }

    /// Of `localIds`, those with no attachment row at all: the upload was cancelled or its task removed.
    public func missingAttachments(localIds: [String]) throws -> [String] {
        guard !localIds.isEmpty else { return [] }
        let present = try database.writer.read { connection in
            try String.fetchAll(connection, sql: """
                SELECT local_id FROM task_attachments WHERE local_id IN (\(sqlPlaceholders(localIds.count)))
                """, arguments: sqlArguments(localIds))
        }
        return localIds.filter { !present.contains($0) }
    }

    /// True if anything local may still need the side-store blob under `key`. Errs towards keeping the file.
    public func isBlobReferenced(key: String) throws -> Bool {
        try database.writer.read { connection in
            try Bool.fetchOne(connection, sql: """
                SELECT EXISTS (SELECT 1 FROM task_attachments WHERE bytes_path = ? OR (pending = 1 AND local_id = ?))
                    OR EXISTS (SELECT 1 FROM outbox WHERE entity_local_id = ? OR instr(payload, ?) > 0)
                    OR EXISTS (SELECT 1 FROM outbox_dead_letter WHERE entity_local_id = ? OR instr(payload, ?) > 0)
                """, arguments: [key, key, key, key, key, key]) ?? true
        }
    }

    /// Local ids of every task with at least one attachment (drives the paperclip indicator).
    public func taskLocalIdsWithAttachments() throws -> [String] {
        try database.writer.read { connection in
            try String.fetchAll(connection, sql: "SELECT DISTINCT task_local_id FROM task_attachments")
        }
    }

    // MARK: Sync path (silent)

    /// Silent: mirrors the server's attachment set for a task. Pending rows are left alone. Mirrored rows are
    /// upserted on (task, server id) so they keep their local id; rows the server no longer has are dropped.
    public func replaceTaskAttachmentsFromServer(taskLocalId: String, _ attachments: [TaskAttachmentResponse]) throws {
        try database.writer.write { connection in
            var deleteSQL = "DELETE FROM task_attachments WHERE task_local_id = ? AND pending = 0"
            var arguments: [(any DatabaseValueConvertible)?] = [taskLocalId]
            if !attachments.isEmpty {
                deleteSQL += " AND server_id NOT IN (\(sqlPlaceholders(attachments.count)))"
                arguments += attachments.map { $0.id as (any DatabaseValueConvertible)? }
            }
            try connection.execute(sql: deleteSQL, arguments: StatementArguments(arguments))
            for item in attachments {
                try connection.execute(sql: """
                    INSERT INTO task_attachments (local_id, task_local_id, server_id, file_id, file_name, file_size,
                           mime, created_at, pending, bytes_path)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
                    ON CONFLICT (task_local_id, server_id) DO UPDATE SET
                        file_id = excluded.file_id, file_name = excluded.file_name, file_size = excluded.file_size,
                        mime = excluded.mime, created_at = excluded.created_at
                    """, arguments: [
                        UUID().uuidString, taskLocalId, item.id, item.file?.id, item.file?.name, item.file?.size,
                        item.file?.mime, item.created
                    ])
            }
        }
    }

    // MARK: User mutations

    /// Records a file the user just attached: a pending row plus its upload op, in one transaction. The caller
    /// writes the bytes to the side-store under `bytesPath` first, so the drain never sees an op without bytes.
    public func insertPendingAttachment(_ payload: AttachmentUploadPayload) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(sql: """
                INSERT INTO task_attachments (local_id, task_local_id, server_id, file_id, file_name, file_size,
                       mime, created_at, pending, bytes_path)
                VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 1, ?)
                """, arguments: [
                    payload.attachmentLocalId, payload.taskLocalId, payload.fileName, payload.size, payload.mime,
                    now, payload.bytesPath
                ])
            try connection.enqueue(
                .taskAttachment,
                localId: payload.attachmentLocalId,
                operation: .upload,
                payload: payload.outboxPayload,
                at: now
            )
        }
    }

    /// Removes one attachment from the local mirror.
    public func deleteAttachmentLocal(taskLocalId: String, attachmentServerId: Int) throws {
        try userWrite(announcing: [.tasks]) { connection in
            try connection.execute(
                sql: "DELETE FROM task_attachments WHERE task_local_id = ? AND server_id = ?",
                arguments: [taskLocalId, attachmentServerId]
            )
        }
    }

    // MARK: Push path and cancellation

    /// The server accepted a queued upload. Turns the pending row into a mirror of the server attachment and swaps
    /// every `cria://pending/{id}` reference in the task's description and comments for `url`. A dirty row still has
    /// an op queued behind this one that reads the row, so the rewrite rides along; a clean row was already pushed
    /// with the placeholder, so it is marked dirty and gets a fresh update op.
    public func finaliseAttachmentUpload(
        attachmentLocalId: String, taskLocalId: String, uploaded: TaskAttachmentResponse, url: String
    ) throws {
        let outcome = try userWrite(announcing: [.tasks]) { connection -> AttachmentRewriteOutcome in
            // A pull between the upload and now may have mirrored the attachment already; keep this row, as its
            // local id is what the UI and the references know.
            try connection.execute(sql: """
                DELETE FROM task_attachments WHERE task_local_id = ? AND server_id = ? AND local_id <> ?
                """, arguments: [taskLocalId, uploaded.id, attachmentLocalId])
            try connection.execute(sql: """
                UPDATE task_attachments
                   SET server_id = ?, file_id = ?, file_name = COALESCE(?, file_name), file_size = COALESCE(?, file_size),
                       mime = COALESCE(?, mime), created_at = COALESCE(?, created_at), pending = 0, bytes_path = NULL
                 WHERE local_id = ?
                """, arguments: [
                    uploaded.id, uploaded.file?.id, uploaded.file?.name, uploaded.file?.size, uploaded.file?.mime,
                    uploaded.created, attachmentLocalId
                ])
            let rewrite = { (html: String) in
                PendingAttachmentRef.replace(in: html, attachmentLocalId: attachmentLocalId, with: url)
            }
            let now = isoNow()
            var result = AttachmentRewriteOutcome()
            try CriaStore.rewriteTaskDescription(connection, taskLocalId: taskLocalId, now: now, outcome: &result, rewrite)
            try CriaStore.rewriteCommentsAfterUpload(connection, taskLocalId: taskLocalId, now: now, outcome: &result, rewrite)
            return result
        }
        if outcome.commentsChanged { bus.notify(.comments) }
        if outcome.queued { bus.notify(.outbox) }
    }

    private static func rewriteTaskDescription(
        _ connection: Database, taskLocalId: String, now: String, outcome: inout AttachmentRewriteOutcome,
        _ rewrite: (String) -> String
    ) throws {
        guard let task = try Row.fetchOne(
            connection, sql: "SELECT description, dirty FROM tasks WHERE local_id = ? LIMIT 1", arguments: [taskLocalId]
        ) else { return }
        let current: String? = task["description"]
        let dirty: Bool = task["dirty"]
        guard let current, !current.isEmpty else { return }
        let updated = rewrite(current)
        guard updated != current else { return }
        if try saveRewrittenDescription(connection, taskLocalId: taskLocalId, description: updated, alreadyDirty: dirty, now: now) {
            outcome.queued = true
        }
    }

    private static func rewriteCommentsAfterUpload(
        _ connection: Database, taskLocalId: String, now: String, outcome: inout AttachmentRewriteOutcome,
        _ rewrite: (String) -> String
    ) throws {
        // `instr` also matches `att10` for `att1`; only a changed text counts as a rewrite.
        let rows = try Row.fetchAll(connection, sql: """
            SELECT local_id, comment, dirty FROM task_comments
             WHERE task_local_id = ? AND deleted = 0 AND instr(comment, ?) > 0
            """, arguments: [taskLocalId, PendingAttachmentRef.prefix])
        for row in rows {
            let localId: String = row["local_id"]
            let current: String = row["comment"]
            let dirty: Bool = row["dirty"]
            let updated = rewrite(current)
            if updated == current { continue }
            outcome.commentsChanged = true
            let queued = try saveRewrittenComment(
                connection, localId: localId, comment: updated, now: now, mode: dirty ? .alreadyDirty : .queueUpdate
            )
            outcome.queued = outcome.queued || queued
        }
    }

    /// Writes a rewritten description. A row that is already dirty has an op queued that reads it; otherwise the
    /// row is saved the way a user edit is (dirty, plus an update op). Returns true if an op was queued.
    @discardableResult
    static func saveRewrittenDescription(
        _ connection: Database, taskLocalId: String, description: String, alreadyDirty: Bool, now: String
    ) throws -> Bool {
        if alreadyDirty {
            try connection.execute(
                sql: "UPDATE tasks SET description = ? WHERE local_id = ?", arguments: [description, taskLocalId]
            )
            return false
        }
        try connection.execute(
            sql: "UPDATE tasks SET description = ?, updated_at = ?, dirty = 1 WHERE local_id = ?",
            arguments: [description, now, taskLocalId]
        )
        try connection.enqueue(.task, localId: taskLocalId, operation: .update, payload: ["description": description], at: now)
        return true
    }

    /// Same as `saveRewrittenDescription`, for a comment. Returns true if an op was queued.
    @discardableResult
    static func saveRewrittenComment(
        _ connection: Database, localId: String, comment: String, now: String, mode: CommentRewriteMode
    ) throws -> Bool {
        if mode == .alreadyDirty {
            try connection.execute(
                sql: "UPDATE task_comments SET comment = ? WHERE local_id = ?", arguments: [comment, localId]
            )
            return false
        }
        try connection.execute(
            sql: "UPDATE task_comments SET comment = ?, updated_at = ?, dirty = 1 WHERE local_id = ?",
            arguments: [comment, now, localId]
        )
        guard mode == .queueUpdate else { return false }
        try connection.enqueue(.taskComment, localId: localId, operation: .update, payload: [:], at: now)
        return true
    }
}
