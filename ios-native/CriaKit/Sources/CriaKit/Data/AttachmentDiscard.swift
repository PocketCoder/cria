import Foundation
import GRDB

extension CriaStore {
    /// User path: drops a pending upload (the user removed the row, or the push found its task gone). Deletes the
    /// row and any queued or dead-lettered upload op, and returns the side-store key so the caller can delete the
    /// bytes. An uploaded attachment keeps its row and returns nil.
    ///
    /// Every inline `cria://pending/{id}` image of it is stripped from task descriptions and comments in the same
    /// transaction, as there will never be a URL to swap in. Each changed row is saved the way a user edit is
    /// (dirty, plus an update op). A comment that has not synced gets no op: its queued create reads the row.
    @discardableResult
    public func discardPendingAttachment(localId: String) throws -> String? {
        let result = try userWrite(announcing: [.tasks, .outbox]) { connection -> (bytesPath: String?, commentsChanged: Bool) in
            let row = try Row.fetchOne(
                connection, sql: "SELECT bytes_path, pending FROM task_attachments WHERE local_id = ?", arguments: [localId]
            )
            var isPending = false
            var bytesPath: String?
            if let row {
                let path: String? = row["bytes_path"]
                isPending = row["pending"]
                bytesPath = isPending ? path : nil
            }
            try connection.execute(
                sql: "DELETE FROM task_attachments WHERE local_id = ? AND pending = 1", arguments: [localId]
            )
            for table in ["outbox", "outbox_dead_letter"] {
                try connection.execute(
                    sql: "DELETE FROM \(table) WHERE entity_type = 'task_attachment' AND entity_local_id = ?",
                    arguments: [localId]
                )
            }
            // An uploaded attachment's references resolve, so only a pending (or already gone) one is stripped.
            guard isPending || row == nil else { return (bytesPath, false) }
            let changed = try CriaStore.stripPendingReferences(connection, attachmentLocalId: localId, now: isoNow())
            return (bytesPath, changed)
        }
        if result.commentsChanged {
            bus.notify(.comments)
        }
        return result.bytesPath
    }

    /// Strips the placeholder image from task descriptions and comments. Returns true if any comment changed.
    private static func stripPendingReferences(_ connection: Database, attachmentLocalId: String, now: String) throws -> Bool {
        let ref = PendingAttachmentRef.ref(attachmentLocalId)
        let tasks = try Row.fetchAll(connection, sql: """
            SELECT local_id, description FROM tasks WHERE deleted = 0 AND instr(description, ?) > 0
            """, arguments: [ref])
        // Comments of a task that is gone or being deleted are left alone: an update op for them could never
        // find the task on the server.
        let comments = try Row.fetchAll(connection, sql: """
            SELECT c.local_id, c.comment, c.server_id FROM task_comments c
              JOIN tasks t ON t.local_id = c.task_local_id AND t.deleted = 0
             WHERE c.deleted = 0 AND instr(c.comment, ?) > 0
            """, arguments: [ref])
        for task in tasks {
            let taskId: String = task["local_id"]
            let current: String = task["description"]
            let updated = PendingAttachmentRef.stripImages(in: current, attachmentLocalId: attachmentLocalId)
            if updated == current { continue }
            try saveRewrittenDescription(connection, taskLocalId: taskId, description: updated, alreadyDirty: false, now: now)
        }
        var commentsChanged = false
        for comment in comments {
            let commentId: String = comment["local_id"]
            let current: String = comment["comment"]
            let serverId: Int = comment["server_id"]
            let updated = PendingAttachmentRef.stripImages(in: current, attachmentLocalId: attachmentLocalId)
            if updated == current { continue }
            commentsChanged = true
            try saveRewrittenComment(
                connection, localId: commentId, comment: updated, now: now, mode: serverId != 0 ? .queueUpdate : .saveOnly
            )
        }
        return commentsChanged
    }
}
