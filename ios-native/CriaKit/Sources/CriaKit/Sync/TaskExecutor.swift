import Foundation
import GRDB

/// Fields compared against the `last_synced` snapshot before an update is pushed.
let taskConflictFields = [
    "title", "description", "done", "due_date", "start_date", "end_date",
    "priority", "percent_done", "hex_color", "position"
]

/// Task create, update and delete. Ported from `executeTaskOp` in `src/sync/push/task.ts`.
public struct TaskExecutor: OutboxExecutor {
    public init() {}

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let localId = op.entityLocalId
        guard var task = try store.pushTask(localId: localId) else { return }  // permanently gone
        task.record = try store.withResolvedDescription(task.record, base: await api.serverBase() ?? "")
        switch op.op {
        case "create": try await create(op, task, api, store)
        case "update": try await update(op, task, api, store)
        case "delete": try await delete(task, api, store)
        default: return
        }
    }

    private func create(_ op: OutboxRow, _ task: PushTask, _ api: ApiClient, _ store: CriaStore) async throws {
        let localId = task.record.localId
        if task.deleted {
            try store.removeTaskLocally(localId: localId)
            return
        }
        if task.record.serverId != nil { return }
        if let cached = cachedCreateResponse(op.payload) {
            try store.markTaskSynced(localId: localId, serverId: cached, updatedAt: nil)
            return
        }
        guard let projectServerId = try store.pushProjectServerId(localId: task.record.projectLocalId), projectServerId > 0 else {
            // Zero or negative ids are pseudo-projects (Favorites, saved filters), never a real destination.
            throw ApiError.blocked("Project not yet synced")
        }
        let response = try await api.send(
            .put, "/projects/\(projectServerId)/tasks", body: taskToBody(task.record, projectServerId: projectServerId)
        )
        let (created, raw) = try Self.decoded(response)
        try store.cacheCreateResponse(opId: op.id, payload: op.payload, serverId: created.id)
        try store.markTaskSynced(localId: localId, serverId: created.id, updatedAt: created.updated, lastSynced: raw, opId: op.id)
    }

    private func update(_ op: OutboxRow, _ task: PushTask, _ api: ApiClient, _ store: CriaStore) async throws {
        if task.deleted { return }  // the delete op handles it
        let localId = task.record.localId
        guard let serverId = task.record.serverId else {
            // The create was lost: re-queue it so the current state, pending edits included, is sent.
            try store.requeueCreateIfMissing(task.record)
            return
        }
        // Never push while the user is deciding how to resolve a conflict.
        if try store.hasUnresolvedConflict(entityType: "task", localId: localId) {
            throw ApiError.conflictBlocked
        }
        let projectServerId = try store.pushProjectServerId(localId: task.record.projectLocalId)
        let reminders = try store.pushReminders(taskLocalId: localId)
        if let lastSynced = task.lastSynced, let current = try? await api.send(.get, "/tasks/\(serverId)"), current.isSuccess {
            let diverged = try store.checkDivergence(
                lastSynced: lastSynced, serverPayload: current.data, fields: taskConflictFields, entityType: "task", localId: localId
            )
            if diverged { return }
        }
        // A failed GET skips the check: the push itself may fail and retry.
        var body = taskToBody(task.record, projectServerId: projectServerId.flatMap { $0 > 0 ? $0 : nil }, reminders: reminders)
        // Vikunja's task update resets the cover image when the body leaves it out, and Cria has no UI for it: send
        // back whatever the server last held, so an edit here keeps a cover set in Vikunja-web.
        if let cover = Self.coverImageId(lastSynced: task.lastSynced) {
            body["cover_image_attachment_id"] = .number(Double(cover))
        }
        let (updated, raw) = try Self.decoded(try await api.send(.post, "/tasks/\(serverId)", body: body))
        try store.markTaskSynced(localId: localId, serverId: nil, updatedAt: updated.updated, lastSynced: raw, opId: op.id)
    }

    static func coverImageId(lastSynced: String?) -> Int? {
        guard let lastSynced, let object = try? CriaStore.jsonObject(lastSynced),
              let id = (object["cover_image_attachment_id"] as? NSNumber)?.intValue, id > 0 else { return nil }
        return id
    }

    /// The decoded task and the server's own JSON, which becomes the new `last_synced` snapshot.
    private static func decoded(_ response: ApiResponse) throws -> (TaskResponse, String) {
        let task = try response.decoded(TaskResponse.self)
        return (task, String(bytes: response.data, encoding: .utf8) ?? "")
    }

    private func delete(_ task: PushTask, _ api: ApiClient, _ store: CriaStore) async throws {
        if let serverId = task.record.serverId {
            try await api.performIgnoring404(.delete, "/tasks/\(serverId)")
        }
        try store.removeTaskLocally(localId: task.record.localId)
    }
}

struct PushTask {
    var record: TaskRecord
    let deleted: Bool
    let lastSynced: String?
}

extension CriaStore {
    /// The task row as the executor needs it, including soft-deleted rows.
    func pushTask(localId: String) throws -> PushTask? {
        try database.writer.read { connection in
            try Row.fetchOne(connection, sql: """
                SELECT \(CriaStore.taskColumns), deleted, last_synced FROM tasks WHERE local_id = ?
                """, arguments: [localId]).map {
                PushTask(record: TaskRecord(row: $0), deleted: $0["deleted"], lastSynced: $0["last_synced"])
            }
        }
    }

    func withResolvedDescription(_ record: TaskRecord, base: String) throws -> TaskRecord {
        let resolved = try resolveUploadedPendingRefs(record.description, serverBase: base)
        return resolved == record.description ? record : record.replacingDescription(resolved)
    }

    func pushProjectServerId(localId: String) throws -> Int? {
        try database.writer.read { try Int.fetchOne($0, sql: "SELECT server_id FROM projects WHERE local_id = ?", arguments: [localId]) }
    }

    func pushReminders(taskLocalId: String) throws -> [ReminderBody] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT reminder_at, relative_period, relative_to FROM task_reminders WHERE task_local_id = ?
                """, arguments: [taskLocalId]).map {
                ReminderBody(reminder: $0["reminder_at"], relativePeriod: $0["relative_period"], relativeTo: $0["relative_to"])
            }
        }
    }

    /// Push path: records the server's answer and announces `tasks`. The row only becomes clean when no other op is
    /// queued for it: an edit made while this request was in flight must stay dirty so a pull cannot overwrite it.
    /// `lastSynced` (the server's reply) becomes the snapshot the next conflict check compares against, so the
    /// client's own push is never mistaken for someone else's change.
    func markTaskSynced(localId: String, serverId: Int?, updatedAt: String?, lastSynced: String? = nil, opId: Int? = nil) throws {
        let now = isoNow()
        try userWrite(announcing: [.tasks]) { connection in
            var pending = false
            if let opId {
                pending = try Bool.fetchOne(connection, sql: """
                    SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_local_id = ? AND id <> ?)
                    """, arguments: [localId, opId]) ?? false
            }
            var assignments = ["synced_at = ?"]
            var arguments: [(any DatabaseValueConvertible)?] = [now]
            if let serverId {
                assignments.append("server_id = ?")
                arguments.append(serverId)
            }
            if let lastSynced {
                assignments.append("last_synced = ?")
                arguments.append(lastSynced)
            }
            if !pending {
                assignments += ["dirty = 0", "updated_at = ?"]
                arguments.append(updatedAt ?? now)
            }
            arguments.append(localId)
            try connection.execute(
                sql: "UPDATE tasks SET \(assignments.joined(separator: ", ")) WHERE local_id = ?",
                arguments: StatementArguments(arguments)
            )
        }
    }

    func removeTaskLocally(localId: String) throws {
        try userWrite(announcing: [.tasks]) { try CriaStore.deleteTaskCascade($0, localId: localId) }
    }

    func requeueCreateIfMissing(_ record: TaskRecord) throws {
        try userWrite(announcing: [.outbox]) { connection in
            let pending = try Bool.fetchOne(connection, sql: """
                SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_local_id = ? AND op = 'create')
                """, arguments: [record.localId]) ?? false
            if !pending {
                try connection.enqueue(
                    .task, localId: record.localId, operation: .create, payload: CriaStore.taskPayload(record), at: isoNow()
                )
            }
        }
    }
}

extension TaskRecord {
    func replacingDescription(_ description: String?) -> TaskRecord {
        var copy = self
        copy.description = description
        return copy
    }
}
