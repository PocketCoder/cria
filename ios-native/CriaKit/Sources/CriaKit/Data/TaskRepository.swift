import Foundation
import GRDB

public struct TaskRecord: Equatable, Sendable {
    public let localId: String
    public let serverId: Int?
    public let projectLocalId: String
    public let title: String
    public let description: String?
    public let done: Bool
    public let doneAt: String?
    public let dueDate: String?
    public let startDate: String?
    public let endDate: String?
    public let priority: Int
    /// Stored as 0 to 1, the same as the server.
    public let percentDone: Double
    public let hexColor: String?
    public let position: Double?
    public let isFavorite: Bool
    public let repeatAfter: Int
    public let repeatMode: Int
    public let updatedAt: String
    public let createdAt: String?

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
        repeatAfter = row["repeat_after"]
        repeatMode = row["repeat_mode"]
        updatedAt = row["updated_at"]
        createdAt = row["created_at"]
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
public struct TaskPatch: Sendable {
    public var title: String?
    public var done: Bool?
    public var dueDate: String?
    public var priority: Int?
    public var isFavorite: Bool?

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
        start_date, end_date, priority, percent_done, hex_color, position, is_favorite, \
        repeat_after, repeat_mode, updated_at, created_at
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
        try Row.fetchOne(connection, sql: "SELECT \(taskColumns) FROM tasks WHERE local_id = ?", arguments: [localId])
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
            let localId = UUID().uuidString
            let now = isoNow()
            try connection.execute(sql: """
                INSERT INTO tasks (local_id, server_id, project_local_id, title, description, done, due_date,
                       priority, percent_done, is_favorite, is_subscribed, repeat_after, repeat_mode,
                       updated_at, created_at, dirty, deleted)
                VALUES (?, NULL, ?, ?, ?, 0, ?, ?, 0, ?, 0, 0, 0, ?, ?, 1, 0)
                """, arguments: [
                    localId, input.projectLocalId, input.title, input.description, input.dueDate,
                    input.priority, input.isFavorite, now, now
                ])
            guard let record = try CriaStore.fetchTask(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            try connection.enqueue(.task, localId: localId, op: .create, payload: CriaStore.taskPayload(record), at: now)
            return record
        }
    }

    @discardableResult
    public func updateTask(localId: String, patch: TaskPatch) throws -> TaskRecord {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            var assignments = ["dirty = 1", "updated_at = ?"]
            var arguments: [(any DatabaseValueConvertible)?] = [now]
            if let title = patch.title {
                assignments.append("title = ?")
                arguments.append(title)
            }
            if let done = patch.done {
                let doneAt: String? = done ? now : nil
                assignments += ["done = ?", "done_at = ?"]
                arguments.append(done)
                arguments.append(doneAt)
            }
            if let dueDate = patch.dueDate {
                assignments.append("due_date = ?")
                arguments.append(dueDate)
            }
            if let priority = patch.priority {
                assignments.append("priority = ?")
                arguments.append(priority)
            }
            if let isFavorite = patch.isFavorite {
                assignments.append("is_favorite = ?")
                arguments.append(isFavorite)
            }
            arguments.append(localId)
            try connection.execute(
                sql: "UPDATE tasks SET \(assignments.joined(separator: ", ")) WHERE local_id = ? AND deleted = 0",
                arguments: StatementArguments(arguments)
            )
            guard let record = try CriaStore.fetchTask(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            try connection.enqueue(.task, localId: localId, op: .update, payload: CriaStore.taskPayload(record), at: now)
            return record
        }
    }

    /// Soft delete. The row stays until the outbox drains, so the delete can be pushed.
    public func deleteTask(localId: String) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE tasks SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?",
                arguments: [now, localId]
            )
            try connection.enqueue(.task, localId: localId, op: .delete, payload: [:], at: now)
        }
    }

    /// Silent server merge for one task. A row with a pending local edit is never overwritten; if the server
    /// also changed a field since the last sync, a conflict is recorded. Returns nil when the project is not synced.
    @discardableResult
    public func upsertTaskFromServer(_ payload: TaskResponse, rawJSON: String) throws -> String? {
        try database.writer.write { connection -> String? in
            guard let projectLocalId = try String.fetchOne(
                connection, sql: "SELECT local_id FROM projects WHERE server_id = ?", arguments: [payload.projectId]
            ) else {
                return nil
            }
            let now = isoNow()
            let existing = try Row.fetchOne(
                connection, sql: "SELECT local_id, dirty, last_synced FROM tasks WHERE server_id = ?", arguments: [payload.id]
            )
            let localId: String
            if let existing {
                localId = existing["local_id"]
                let dirty: Bool = existing["dirty"]
                if dirty {
                    let lastSynced: String? = existing["last_synced"]
                    try CriaStore.recordConflictIfDiverged(connection, localId: localId, lastSynced: lastSynced, remoteJSON: rawJSON, now: now)
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
                payload.repeatAfter ?? 0, payload.repeatMode ?? 0, payload.identifier, payload.updated ?? now,
                payload.created, payload.createdBy?.id, now, rawJSON, localId
            ]
            try connection.execute(sql: """
                UPDATE tasks SET project_local_id = ?, title = ?, description = ?, done = ?, done_at = ?,
                       due_date = ?, start_date = ?, end_date = ?, priority = ?, percent_done = ?, hex_color = ?,
                       position = ?, is_favorite = ?, repeat_after = ?, repeat_mode = ?, identifier = ?,
                       updated_at = ?, created_at = ?, created_by_id = ?, synced_at = ?, last_synced = ?,
                       dirty = 0, deleted = 0
                 WHERE local_id = ?
                """, arguments: StatementArguments(arguments))
            return localId
        }
    }

    /// Fields compared for conflicts. Mirrors the TypeScript conflict field list for tasks.
    static let conflictFields = ["title", "description", "done", "due_date"]

    static func recordConflictIfDiverged(
        _ connection: Database, localId: String, lastSynced: String?, remoteJSON: String, now: String
    ) throws {
        guard let lastSynced, lastSynced != remoteJSON else { return }
        let duplicate = try Int.fetchOne(connection, sql: """
            SELECT id FROM conflicts
             WHERE entity_type = 'task' AND entity_local_id = ?
               AND local_snapshot = ? AND remote_snapshot = ?
             LIMIT 1
            """, arguments: [localId, lastSynced, remoteJSON])
        guard duplicate == nil else { return }
        guard let before = try jsonObject(lastSynced), let after = try jsonObject(remoteJSON) else { return }
        let fields = conflictFields.filter { field in
            (before[field] as? AnyHashable) != (after[field] as? AnyHashable)
        }
        guard !fields.isEmpty else { return }
        let fieldsJSON = String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self)
        try connection.execute(sql: """
            INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
            VALUES ('task', ?, ?, ?, ?, ?)
            """, arguments: [localId, fieldsJSON, lastSynced, remoteJSON, now])
    }

    static func jsonObject(_ text: String) throws -> [String: Any]? {
        try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
    }
}
