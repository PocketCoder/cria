import Foundation
import GRDB

public struct TaskRecord: Equatable, Sendable {
    public internal(set) var localId: String
    public internal(set) var serverId: Int?
    public internal(set) var projectLocalId: String
    public internal(set) var title: String
    public internal(set) var description: String?
    public internal(set) var done: Bool
    public internal(set) var doneAt: String?
    public internal(set) var dueDate: String?
    public internal(set) var startDate: String?
    public internal(set) var endDate: String?
    public internal(set) var priority: Int
    /// Stored as 0 to 1, the same as the server.
    public internal(set) var percentDone: Double
    public internal(set) var hexColor: String?
    public internal(set) var position: Double?
    public internal(set) var isFavorite: Bool
    /// Whether the user gets the server's notifications for this task. Set by the pull and by `setTaskSubscribed`.
    public internal(set) var isSubscribed: Bool
    public internal(set) var repeatAfter: Int
    public internal(set) var repeatMode: Int
    public internal(set) var updatedAt: String
    public internal(set) var createdAt: String?
    /// The creator's server user id, from the pull. Nil for tasks created here and not yet re-read.
    public internal(set) var createdById: Int?
    /// The server's readable identifier, such as "PROJ-42" (read-only; nil until the task has been pulled).
    public internal(set) var identifier: String?
    /// The server id of the attachment used as the task's cover image (`cover_image_attachment_id`). 0 means none was
    /// set; nil means the row has not been read from the server since covers were stored, so nothing is known.
    public internal(set) var coverImageAttachmentId: Int?

    /// The cover attachment's server id, or nil when the task has no cover.
    public var coverAttachmentServerId: Int? {
        coverImageAttachmentId.flatMap { $0 > 0 ? $0 : nil }
    }

    init(row: Row) {
        localId = row["local_id"]
        serverId = row["server_id"]
        projectLocalId = row["project_local_id"]
        title = row["title"]
        description = row["description"]
        done = row["done"]
        doneAt = row["done_at"]
        dueDate = row["due_date"]
        startDate = row["start_date"]
        endDate = row["end_date"]
        priority = row["priority"]
        percentDone = row["percent_done"]
        hexColor = row["hex_color"]
        position = row["position"]
        isFavorite = row["is_favorite"]
        isSubscribed = row["is_subscribed"]
        repeatAfter = row["repeat_after"]
        repeatMode = row["repeat_mode"]
        updatedAt = row["updated_at"]
        createdAt = row["created_at"]
        createdById = row["created_by_id"]
        identifier = row["identifier"]
        coverImageAttachmentId = row["cover_image_id"]
    }
}

/// Filters for task lists. Smart views and saved filters build on these.
public struct TaskQuery: Sendable {
    public var projectLocalId: String?
    public var includeDone: Bool
    public var favoritesOnly: Bool

    public init(projectLocalId: String? = nil, includeDone: Bool = true, favoritesOnly: Bool = false) {
        self.projectLocalId = projectLocalId
        self.includeDone = includeDone
        self.favoritesOnly = favoritesOnly
    }
}

/// Fields for a new local task.
public struct TaskInput: Sendable {
    public var title: String
    public var projectLocalId: String
    public var description: String?
    public var dueDate: String?
    public var priority: Int
    public var isFavorite: Bool
    public var repeatAfter = 0
    public var repeatMode = 0

    public init(title: String, projectLocalId: String, description: String? = nil, dueDate: String? = nil,
                priority: Int = 0, isFavorite: Bool = false) {
        self.title = title
        self.projectLocalId = projectLocalId
        self.description = description
        self.dueDate = dueDate
        self.priority = priority
        self.isFavorite = isFavorite
    }
}

/// Partial edit. A nil field is left unchanged.
public struct TaskPatch: Equatable, Sendable {
    public var title: String?
    public var done: Bool?
    /// An empty string clears the date (as for `startDate` and `endDate`); the push then sends null.
    public var dueDate: String?
    public var priority: Int?
    public var isFavorite: Bool?
    /// An empty string clears the description.
    public var description: String?
    public var startDate: String?
    public var endDate: String?
    /// 0 to 1, as stored locally and on the server.
    public var percentDone: Double?
    /// Moves the task to another project.
    public var projectLocalId: String?
    /// Recurrence: interval in seconds, and mode (1 = monthly).
    public var repeatAfter: Int?
    public var repeatMode: Int?
    /// Task colour as six hex digits (a leading `#` is dropped); an empty string clears it. The push sends it raw.
    public var hexColor: String?
    /// Server id of the attachment to use as the cover image; 0 removes the cover.
    public var coverImageAttachmentId: Int?

    public init(title: String? = nil, done: Bool? = nil, dueDate: String? = nil,
                priority: Int? = nil, isFavorite: Bool? = nil) {
        self.title = title
        self.done = done
        self.dueDate = dueDate
        self.priority = priority
        self.isFavorite = isFavorite
    }
}

extension CriaStore {
    static let taskColumns = """
        local_id, server_id, project_local_id, title, description, done, done_at, due_date, \
        start_date, end_date, priority, percent_done, hex_color, position, is_favorite, is_subscribed, \
        repeat_after, repeat_mode, updated_at, created_at, created_by_id, identifier, cover_image_id
        """

    /// Same order as `listTasksForProject` in `src/db/tasks.ts`. Positions are local per view, so no server sort.
    static let taskOrder = """
        done ASC, position IS NULL, position ASC, due_date IS NULL, due_date ASC, title COLLATE NOCASE ASC
        """

    public func tasks(matching query: TaskQuery) throws -> [TaskRecord] {
        var clauses = ["deleted = 0"]
        var arguments: [(any DatabaseValueConvertible)?] = []
        if let projectLocalId = query.projectLocalId {
            clauses.append("project_local_id = ?")
            arguments.append(projectLocalId)
        }
        if !query.includeDone {
            clauses.append("done = 0")
        }
        if query.favoritesOnly {
            clauses.append("is_favorite = 1")
        }
        let sql = """
            SELECT \(CriaStore.taskColumns) FROM tasks
             WHERE \(clauses.joined(separator: " AND "))
             ORDER BY \(CriaStore.taskOrder)
            """
        return try database.writer.read { connection in
            try Row.fetchAll(connection, sql: sql, arguments: StatementArguments(arguments)).map(TaskRecord.init(row:))
        }
    }

    public func task(localId: String) throws -> TaskRecord? {
        try database.writer.read { connection in
            try CriaStore.fetchTask(connection, localId: localId)
        }
    }

    static func fetchTask(_ connection: Database, localId: String) throws -> TaskRecord? {
        try Row.fetchOne(
            connection, sql: "SELECT \(taskColumns) FROM tasks WHERE local_id = ? AND deleted = 0", arguments: [localId]
        )
            .map(TaskRecord.init(row:))
    }

    /// Full-object body queued with each task write, so push executors can build the wire body later.
    static func taskPayload(_ task: TaskRecord) -> [String: Any] {
        [
            "project_local_id": task.projectLocalId,
            "title": task.title,
            "description": jsonNullable(task.description),
            "done": task.done,
            "done_at": jsonNullable(task.doneAt),
            "due_date": jsonNullable(task.dueDate),
            "start_date": jsonNullable(task.startDate),
            "end_date": jsonNullable(task.endDate),
            "priority": task.priority,
            "percent_done": task.percentDone,
            "hex_color": jsonNullable(task.hexColor),
            "is_favorite": task.isFavorite,
            "repeat_after": task.repeatAfter,
            "repeat_mode": task.repeatMode
        ]
    }

    @discardableResult
    public func createTask(_ input: TaskInput) throws -> TaskRecord {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            try CriaStore.insertTask(connection, input)
        }
    }

    /// The insert and its create op, inside a write the caller holds (so a subtask and its link share one transaction).
    static func insertTask(_ connection: Database, _ input: TaskInput) throws -> TaskRecord {
        let localId = UUID().uuidString
        let now = isoNow()
        try connection.execute(sql: """
            INSERT INTO tasks (local_id, server_id, project_local_id, title, description, done, due_date,
                   priority, percent_done, is_favorite, is_subscribed, repeat_after, repeat_mode,
                   updated_at, created_at, dirty, deleted)
            VALUES (?, NULL, ?, ?, ?, 0, ?, ?, 0, ?, 0, ?, ?, ?, ?, 1, 0)
            """, arguments: [
                localId, input.projectLocalId, input.title, input.description, input.dueDate,
                input.priority, input.isFavorite, input.repeatAfter, input.repeatMode, now, now
            ])
        guard let record = try CriaStore.fetchTask(connection, localId: localId) else {
            throw CriaStoreError.notFound(localId)
        }
        try connection.enqueue(.task, localId: localId, operation: .create, payload: CriaStore.taskPayload(record), at: now)
        return record
    }

    @discardableResult
    public func updateTask(localId: String, patch: TaskPatch) throws -> TaskRecord {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            let (assignments, changes) = patch.assignments(now: now)
            let arguments = changes + [localId]
            try connection.execute(
                sql: "UPDATE tasks SET \(assignments.joined(separator: ", ")) WHERE local_id = ? AND deleted = 0",
                arguments: StatementArguments(arguments)
            )
            guard let record = try CriaStore.fetchTask(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            try connection.enqueue(.task, localId: localId, operation: .update, payload: CriaStore.taskPayload(record), at: now)
            if patch.done != nil { try CriaStore.refreshParentProgress(connection, childLocalId: localId, now: now) }
            if patch.done == true { try CriaStore.resetSubtasksIfRepeating(connection, task: record, now: now) }
            return record
        }
    }

    /// Soft delete. The row stays until the outbox drains, so the delete can be pushed. With an `undoWindow` the
    /// delete op waits that long before it may be sent (it holds the queue head meanwhile), so `undoDeleteTask` can
    /// still take it back.
    public func deleteTask(localId: String, undoWindow: TimeInterval = 0) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE tasks SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ? AND deleted = 0",
                arguments: [now, localId]
            )
            guard connection.changesCount > 0 else { return }
            try connection.enqueue(.task, localId: localId, operation: .delete, payload: [:], at: now)
            try CriaStore.refreshParentProgress(connection, childLocalId: localId, now: now)
            if undoWindow > 0 {
                try connection.execute(
                    sql: "UPDATE outbox SET next_attempt_at = ? WHERE id = ?",
                    arguments: [Date().addingTimeInterval(undoWindow).formatted(.iso8601), connection.lastInsertedRowID]
                )
            }
        }
    }

    /// Takes back a delete that has not been sent yet. False when it already went (or never existed).
    @discardableResult
    public func undoDeleteTask(localId: String) throws -> Bool {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            guard let opId = try Int.fetchOne(connection, sql: """
                SELECT id FROM outbox WHERE entity_type = 'task' AND entity_local_id = ? AND op = 'delete' AND attempts = 0
                 ORDER BY id DESC LIMIT 1
                """, arguments: [localId]) else { return false }
            try connection.execute(sql: "DELETE FROM outbox WHERE id = ?", arguments: [opId])
            try connection.execute(sql: "UPDATE tasks SET deleted = 0 WHERE local_id = ?", arguments: [localId])
            guard let record = try CriaStore.fetchTask(connection, localId: localId) else { return false }
            let queued = try Bool.fetchOne(connection, sql: """
                SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_local_id = ?)
                """, arguments: [localId]) ?? false
            if record.serverId == nil, !queued {
                // Its create op already ran and stood down for the delete: queue it again.
                try connection.enqueue(.task, localId: localId, operation: .create, payload: CriaStore.taskPayload(record), at: isoNow())
            }
            let stillDirty = record.serverId == nil || queued
            try connection.execute(sql: "UPDATE tasks SET dirty = ? WHERE local_id = ?", arguments: [stillDirty, localId])
            try CriaStore.refreshParentProgress(connection, childLocalId: localId, now: isoNow())
            return true
        }
    }

    /// Silent server merge for one task. A row with a pending local edit is never overwritten; if the server
    /// also changed a field since the last sync, a conflict is recorded. Returns nil when the project is not synced.
    @discardableResult
    public func upsertTaskFromServer(_ payload: TaskResponse, rawJSON: String, in held: Database? = nil) throws -> String? {
        try inWrite(held) { connection -> String? in
            guard let projectLocalId = try String.fetchOne(
                connection, sql: "SELECT local_id FROM projects WHERE server_id = ?", arguments: [payload.projectId]
            ) else {
                return nil
            }
            let now = isoNow()
            let existing = try Row.fetchOne(
                connection, sql: "SELECT local_id, dirty, deleted, last_synced FROM tasks WHERE server_id = ?", arguments: [payload.id]
            )
            let localId: String
            if let existing {
                localId = existing["local_id"]
                let dirty: Bool = existing["dirty"]
                let deleted: Bool = existing["deleted"]
                // Hidden by a project delete that has not reached the server yet: keep it hidden.
                if deleted && !dirty { return nil }
                if dirty {
                    let lastSynced: String? = existing["last_synced"]
                    try CriaStore.recordConflictIfDiverged(
                        connection, localId: localId, lastSynced: lastSynced, remoteJSON: rawJSON, now: now
                    )
                    return localId
                }
            } else {
                localId = UUID().uuidString
                try connection.execute(
                    sql: """
                        INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
                        VALUES (?, ?, ?, ?, ?, 0, 0)
                        """,
                    arguments: [localId, payload.id, projectLocalId, payload.title, now]
                )
            }
            let arguments: [(any DatabaseValueConvertible)?] = [
                projectLocalId, payload.title, payload.description, payload.done ?? false, payload.doneAt,
                payload.dueDate, payload.startDate, payload.endDate, payload.priority ?? 0,
                payload.percentDone ?? 0, payload.hexColor, payload.position, payload.isFavorite ?? false,
                payload.isSubscribed ?? false,
                payload.repeatAfter ?? 0, payload.repeatMode ?? 0, payload.identifier, payload.updated ?? now,
                payload.created, CriaStore.rememberCreator(payload.createdBy), payload.coverImageAttachmentId ?? 0,
                now, rawJSON, localId
            ]
            try connection.execute(sql: """
                UPDATE tasks SET project_local_id = ?, title = ?, description = ?, done = ?, done_at = ?,
                       due_date = ?, start_date = ?, end_date = ?, priority = ?, percent_done = ?, hex_color = ?,
                       position = ?, is_favorite = ?, is_subscribed = ?, repeat_after = ?, repeat_mode = ?,
                       identifier = ?, updated_at = ?, created_at = ?, created_by_id = ?, cover_image_id = ?,
                       synced_at = ?, last_synced = ?, dirty = 0, deleted = 0
                 WHERE local_id = ?
                """, arguments: StatementArguments(arguments))
            return localId
        }
    }

    /// The creator's id for the row, after noting their name and username for the table's Created By column.
    static func rememberCreator(_ creator: TaskResponse.CreatedBy?) -> Int? {
        guard let id = creator?.id else { return nil }
        UserNameDirectory.shared.remember([(id, creator?.name)], usernames: [(id, creator?.username)])
        return id
    }

    /// Fields compared for conflicts. Mirrors the TypeScript conflict field list for tasks.
    static let conflictFields = ["title", "description", "done", "due_date"]

    static func recordConflictIfDiverged(
        _ connection: Database, localId: String, lastSynced: String?, remoteJSON: String, now: String
    ) throws {
        try recordConflictIfDiverged(connection, entityType: "task", localId: localId, lastSynced: lastSynced,
                                     remoteJSON: remoteJSON, fields: conflictFields, now: now)
    }

    /// A pull found a row with a pending local edit whose server copy also changed one of `fields` since the last
    /// sync: record a conflict (once per pair of snapshots). Ported from `mergeFromServer` in `src/db/syncMerge.ts`.
    static func recordConflictIfDiverged(
        _ connection: Database, entityType: String, localId: String, lastSynced: String?, remoteJSON: String,
        fields candidates: [String], now: String
    ) throws {
        guard let lastSynced, lastSynced != remoteJSON else { return }
        let duplicate = try Int.fetchOne(connection, sql: """
            SELECT id FROM conflicts
             WHERE entity_type = ? AND entity_local_id = ?
               AND local_snapshot = ? AND remote_snapshot = ?
             LIMIT 1
            """, arguments: [entityType, localId, lastSynced, remoteJSON])
        guard duplicate == nil else { return }
        guard let before = try jsonObject(lastSynced), let after = try jsonObject(remoteJSON) else { return }
        let fields = candidates.filter { field in
            !conflictValuesEqual(field: field, before[field], after[field])
        }
        guard !fields.isEmpty else { return }
        let fieldsData = try JSONSerialization.data(withJSONObject: fields)
        let fieldsJSON = String(bytes: fieldsData, encoding: .utf8) ?? "[]"
        try connection.execute(sql: """
            INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """, arguments: [entityType, localId, fieldsJSON, lastSynced, remoteJSON, now])
    }

    static func jsonObject(_ text: String) throws -> [String: Any]? {
        try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
    }
}
