import Foundation
import GRDB

/// One user in a comment's reaction list.
public struct ReactionUserRecord: Codable, Equatable, Sendable {
    public let id: Int?
    public let name: String?
    public let username: String?

    public init(id: Int?, name: String? = nil, username: String? = nil) {
        self.id = id
        self.name = name
        self.username = username
    }
}

/// Emoji to the users who reacted with it. Stored as a JSON blob on the comment row (migration 014).
public typealias ReactionMap = [String: [ReactionUserRecord]]

/// A task comment row. Ported from `TaskComment` in `src/db/comments.ts`.
public struct CommentRecord: Equatable, Sendable {
    public let localId: String
    /// 0 until the create has been pushed.
    public let serverId: Int
    public let taskLocalId: String
    public let comment: String
    public let authorName: String?
    public let authorServerId: Int?
    public let createdAt: String?
    public let updatedAt: String?
    public let read: Bool
    public let syncedAt: String?
    public let dirty: Bool
    public let deleted: Bool
    public let reactions: ReactionMap?

    init(row: Row) {
        let reactionsJSON: String? = row["reactions"]
        localId = row["local_id"]
        serverId = row["server_id"]
        taskLocalId = row["task_local_id"]
        comment = row["comment"]
        authorName = row["author_name"]
        authorServerId = row["author_server_id"]
        createdAt = row["created_at"]
        updatedAt = row["updated_at"]
        read = row["read"]
        syncedAt = row["synced_at"]
        dirty = row["dirty"]
        deleted = row["deleted"]
        reactions = reactionsJSON.flatMap { try? JSONDecoder().decode(ReactionMap.self, from: Data($0.utf8)) }
    }
}

/// What the sync path knows about a local comment row before merging.
private struct ExistingComment {
    let localId: String
    let serverId: Int
    let read: Bool
    let dirty: Bool
    let deleted: Bool

    init(row: Row) {
        localId = row["local_id"]
        serverId = row["server_id"]
        read = row["read"]
        dirty = row["dirty"]
        deleted = row["deleted"]
    }

    /// A pending local edit or delete: the outbox is authoritative, so a pull must not touch the row.
    var isLocallyOwned: Bool { dirty || deleted }

    /// A clean row the server no longer holds.
    func vanished(from seen: Set<Int>) -> Bool {
        !isLocallyOwned && serverId != 0 && !seen.contains(serverId)
    }
}

extension CriaStore {
    static let commentColumns = """
        local_id, server_id, task_local_id, comment, author_server_id, author_name, created_at, updated_at, \
        read, synced_at, dirty, deleted, reactions
        """

    // MARK: Reads

    public func comments(forTask taskLocalId: String) throws -> [CommentRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.commentColumns) FROM task_comments
                 WHERE task_local_id = ? AND deleted = 0
                 ORDER BY created_at ASC, server_id ASC
                """, arguments: [taskLocalId]).map(CommentRecord.init(row:))
        }
    }

    /// One comment by local id, including a soft-deleted one.
    public func comment(localId: String) throws -> CommentRecord? {
        try database.writer.read { connection in
            try CriaStore.fetchComment(connection, localId: localId)
        }
    }

    static func fetchComment(_ connection: Database, localId: String) throws -> CommentRecord? {
        try Row.fetchOne(connection, sql: """
            SELECT \(commentColumns) FROM task_comments WHERE local_id = ? LIMIT 1
            """, arguments: [localId]).map(CommentRecord.init(row:))
    }

    public func unreadCommentCount(forTask taskLocalId: String) throws -> Int {
        try database.writer.read { connection in
            try Int.fetchOne(connection, sql: """
                SELECT COUNT(*) FROM task_comments WHERE task_local_id = ? AND read = 0 AND deleted = 0
                """, arguments: [taskLocalId]) ?? 0
        }
    }

    /// Client-side read tracking. Silent, like the TypeScript version.
    public func markCommentsAsRead(taskLocalId: String) throws {
        try database.writer.write { connection in
            try connection.execute(
                sql: "UPDATE task_comments SET read = 1 WHERE task_local_id = ? AND read = 0",
                arguments: [taskLocalId]
            )
        }
    }

    // MARK: Sync path (silent)

    static func encodeReactions(_ map: ReactionMap) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(map) else { return nil }
        return String(bytes: data, encoding: .utf8)
    }

    /// Silent: replaces the local mirror of a task's comments with the server's set. Dirty and soft-deleted rows
    /// are never overwritten or removed (the outbox is authoritative), the `read` flag survives a re-sync, and clean
    /// rows the server no longer holds are deleted. Does nothing while the task itself has a pending local edit.
    public func replaceTaskCommentsFromServer(taskLocalId: String, _ comments: [CommentResponse]) throws {
        try database.writer.write { connection in
            let taskDirty = try Bool.fetchOne(
                connection, sql: "SELECT dirty FROM tasks WHERE local_id = ? LIMIT 1", arguments: [taskLocalId]
            ) ?? false
            if taskDirty { return }
            let existing = try Row.fetchAll(connection, sql: """
                SELECT local_id, server_id, read, dirty, deleted FROM task_comments WHERE task_local_id = ?
                """, arguments: [taskLocalId]).map(ExistingComment.init(row:))
            var byServerId: [Int: ExistingComment] = [:]
            for row in existing where row.serverId > 0 {
                byServerId[row.serverId] = row
            }
            let now = isoNow()
            var seen = Set<Int>()
            for item in comments {
                guard item.comment?.isEmpty == false else { continue }
                seen.insert(item.id)
                let row = byServerId[item.id]
                if let row, row.isLocallyOwned { continue }
                try CriaStore.saveServerComment(connection, taskLocalId: taskLocalId, item, existing: row, now: now)
            }
            for row in existing where row.vanished(from: seen) {
                try connection.execute(sql: "DELETE FROM task_comments WHERE local_id = ?", arguments: [row.localId])
            }
        }
    }

    private static func saveServerComment(
        _ connection: Database, taskLocalId: String, _ item: CommentResponse, existing: ExistingComment?, now: String
    ) throws {
        let text = item.comment ?? ""
        let authorName = item.author?.name ?? item.author?.username
        let reactionsJSON = item.reactions.flatMap { reactions -> String? in
            let map = reactions.mapValues { users in
                users.map { ReactionUserRecord(id: $0.id, name: $0.name, username: $0.username) }
            }
            return encodeReactions(map)
        }
        let read = existing?.read ?? false
        if let existing {
            try connection.execute(sql: """
                UPDATE task_comments
                   SET comment = ?, author_server_id = ?, author_name = ?, created_at = ?, updated_at = ?,
                       read = ?, synced_at = ?, reactions = ?, dirty = 0, deleted = 0
                 WHERE local_id = ?
                """, arguments: [
                    text, item.author?.id, authorName, item.created, item.updated, read, now, reactionsJSON, existing.localId
                ])
        } else {
            try connection.execute(sql: """
                INSERT INTO task_comments (local_id, server_id, task_local_id, comment, author_server_id, author_name,
                       created_at, updated_at, read, synced_at, reactions, dirty, deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                """, arguments: [
                    UUID().uuidString, item.id, taskLocalId, text, item.author?.id, authorName,
                    item.created, item.updated, read, now, reactionsJSON
                ])
        }
    }

    // MARK: User mutations

    /// Adds a comment locally (server id 0, dirty, already read) and queues its create. The author comes from the
    /// signed-in user so the name shows straight away instead of waiting for the next pull. Returns the local id.
    @discardableResult
    public func createComment(
        taskLocalId: String, comment: String, authorName: String? = nil, authorServerId: Int? = nil
    ) throws -> String {
        try userWrite(announcing: [.comments, .outbox]) { connection in
            let localId = UUID().uuidString
            let now = isoNow()
            try connection.execute(sql: """
                INSERT INTO task_comments (local_id, server_id, task_local_id, comment, author_server_id, author_name,
                       created_at, updated_at, read, synced_at, reactions, dirty, deleted)
                VALUES (?, 0, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, 1, 0)
                """, arguments: [localId, taskLocalId, comment, authorServerId, authorName, now, now])
            try connection.enqueue(.taskComment, localId: localId, operation: .create, payload: [:], at: now)
            return localId
        }
    }

    public func updateComment(localId: String, comment: String) throws {
        try userWrite(announcing: [.comments, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE task_comments SET comment = ?, updated_at = ?, dirty = 1 WHERE local_id = ? AND deleted = 0",
                arguments: [comment, now, localId]
            )
            try connection.enqueue(.taskComment, localId: localId, operation: .update, payload: [:], at: now)
        }
    }

    /// Soft delete. The row stays until the outbox drains, so the delete can be pushed.
    public func deleteComment(localId: String) throws {
        try userWrite(announcing: [.comments, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE task_comments SET deleted = 1, updated_at = ?, dirty = 1 WHERE local_id = ?",
                arguments: [now, localId]
            )
            try connection.enqueue(.taskComment, localId: localId, operation: .delete, payload: [:], at: now)
        }
    }

    /// Optimistic local half of a reaction toggle: adds the user's reaction, or removes it if already present.
    /// Returns true if the reaction was added, false if removed, nil if nothing changed (unknown or deleted comment,
    /// or a user without a server id). The caller sends the matching API request; the next pull corrects a failure.
    @discardableResult
    public func toggleCommentReaction(commentLocalId: String, emoji: String, user: ReactionUserRecord) throws -> Bool? {
        guard let userId = user.id, userId != 0 else { return nil }
        let added: Bool? = try userWrite(announcing: []) { connection in
            guard let current = try CriaStore.fetchComment(connection, localId: commentLocalId), !current.deleted else {
                return nil
            }
            var reactions = current.reactions ?? [:]
            var reactors = reactions[emoji] ?? []
            let hasReacted = reactors.contains { $0.id == userId }
            if hasReacted {
                reactors.removeAll { $0.id == userId }
            } else {
                reactors.append(user)
            }
            reactions[emoji] = reactors.isEmpty ? nil : reactors
            try connection.execute(
                sql: "UPDATE task_comments SET reactions = ? WHERE local_id = ?",
                arguments: [CriaStore.encodeReactions(reactions), commentLocalId]
            )
            return !hasReacted
        }
        if added != nil {
            bus.notify(.comments)
        }
        return added
    }
}
