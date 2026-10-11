import Foundation
import GRDB

/// View ops. Ported from `src/sync/push/view.ts`.
public struct ViewExecutor: OutboxExecutor {
    public init() {}

    func body(_ view: ViewRecord) -> JSONBody {
        var body: JSONBody = [
            "title": .string(view.title),
            "view_kind": .string(view.viewKind.rawValue),
            "bucket_configuration_mode": .string(view.bucketConfigurationMode.rawValue),
            // Vikunja uses 0 for "no done/default bucket".
            "done_bucket_id": .number(Double(view.doneBucketServerId ?? 0)),
            "default_bucket_id": .number(Double(view.defaultBucketServerId ?? 0))
        ]
        if let position = view.position { body["position"] = .number(position) }
        // Stored as the server's TaskCollection JSON; a bare string is wrapped.
        if let raw = view.filter, !raw.isEmpty {
            if raw.trimmingCharacters(in: .whitespaces).hasPrefix("{"), let parsed = jsonValue(parsing: raw) {
                body["filter"] = parsed
            } else if !raw.trimmingCharacters(in: .whitespaces).hasPrefix("{") {
                body["filter"] = .object(["filter": .string(raw)])
            }
        }
        // The server's view update writes bucket_configuration unconditionally, so omitting it would wipe a
        // filter-mode board's buckets on a mere rename.
        if case .array(let configuration)? = jsonValue(parsing: view.bucketConfiguration) {
            body["bucket_configuration"] = .array(configuration)
        }
        return body
    }

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let localId = op.entityLocalId
        guard let row = try store.pushRow("""
            SELECT \(CriaStore.viewColumns), deleted FROM project_views WHERE local_id = ?
            """, localId) else { return }
        let view = ViewRecord(row: row)
        let deleted: Bool = row["deleted"]
        let projectServerId = try store.pushInt("SELECT server_id FROM projects WHERE local_id = ?", view.projectLocalId)

        switch op.op {
        case "create":
            if deleted {
                try store.dropRow(table: "project_views", localId: localId, announcing: [.views])
                return
            }
            if view.serverId != nil { return }
            if let cached = cachedCreateResponse(op.payload) {
                try store.markCreated(table: "project_views", localId: localId, serverId: cached, updatedAt: nil,
                                      onlyIfUnchangedSince: nil, announcing: .views)
                return
            }
            guard let projectServerId else { throw ApiError.blocked("view: parent project not synced yet") }
            let created = try await api.createView(projectId: projectServerId, body(view))
            try store.cacheCreateResponse(opId: op.id, payload: op.payload, serverId: created.id)
            try store.markCreated(table: "project_views", localId: localId, serverId: created.id, updatedAt: nil,
                                  onlyIfUnchangedSince: nil, announcing: .views)
        case "update":
            if deleted { return }
            if view.serverId == nil {
                // A create would sit ahead of this op (FIFO). With none queued the view is a placeholder, no
                // server id is coming, and waiting would stall the whole outbox.
                let hasCreate = try store.pushInt("""
                    SELECT id FROM outbox WHERE entity_type = 'view' AND entity_local_id = ? AND op = 'create' LIMIT 1
                    """, localId) != nil
                if !hasCreate {
                    throw ApiError(status: 0, code: nil,
                                   message: "view: never synced, so this edit has nothing to update", retryable: false)
                }
            }
            guard let serverId = view.serverId, let projectServerId else { throw ApiError.blocked("view: not synced yet") }
            _ = try await api.updateView(projectId: projectServerId, id: serverId, body(view))
            try store.markPushed(table: "project_views", localId: localId, updatedAt: nil, onlyIfUnchangedSince: nil, announcing: .views)
        case "delete":
            if let serverId = view.serverId, let projectServerId {
                try await api.performIgnoring404(.delete, "/projects/\(projectServerId)/views/\(serverId)")
            }
            try store.dropRow(table: "project_views", localId: localId, announcing: [.views])
        default:
            return
        }
    }
}

struct ViewContext {
    let viewServerId: Int?
    let projectServerId: Int?
}

extension CriaStore {
    /// Server ids of a view and its project. Either is nil while unsynced.
    func viewContext(viewLocalId: String) throws -> ViewContext {
        try database.writer.read { connection in
            let row = try Row.fetchOne(connection, sql: """
                SELECT pv.server_id AS vs, p.server_id AS ps FROM project_views pv
                  JOIN projects p ON p.local_id = pv.project_local_id WHERE pv.local_id = ?
                """, arguments: [viewLocalId])
            return ViewContext(viewServerId: row?["vs"], projectServerId: row?["ps"])
        }
    }
}

/// Bucket ops. Ported from `executeBucketOp` in `src/sync/push/kanban.ts`.
public struct BucketExecutor: OutboxExecutor {
    public init() {}

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let localId = op.entityLocalId
        guard let row = try store.pushRow("""
            SELECT \(CriaStore.bucketColumns), deleted FROM buckets WHERE local_id = ?
            """, localId) else { return }
        let bucket = BucketRecord(row: row)
        let deleted: Bool = row["deleted"]
        let context = try store.viewContext(viewLocalId: bucket.viewLocalId)

        switch op.op {
        case "create":
            if deleted { return try drop(localId, store) }
            if bucket.serverId != nil { return }
            if let cached = cachedCreateResponse(op.payload) {
                try store.markCreated(table: "buckets", localId: localId, serverId: cached, updatedAt: nil,
                                      onlyIfUnchangedSince: nil, announcing: .views)
                return
            }
            guard let projectId = context.projectServerId, let viewId = context.viewServerId else {
                throw ApiError.blocked("bucket: parent view not synced yet")
            }
            let created = try await api.createBucket(projectId: projectId, viewId: viewId, body(bucket))
            try store.cacheCreateResponse(opId: op.id, payload: op.payload, serverId: created.id)
            try store.markCreated(table: "buckets", localId: localId, serverId: created.id, updatedAt: nil,
                                  onlyIfUnchangedSince: nil, announcing: .views)
        case "update":
            if deleted { return }
            guard let serverId = bucket.serverId, let projectId = context.projectServerId, let viewId = context.viewServerId else {
                throw ApiError.blocked("bucket: not synced yet")
            }
            _ = try await api.updateBucket(projectId: projectId, viewId: viewId, id: serverId, body(bucket))
            try store.markPushed(table: "buckets", localId: localId, updatedAt: nil, onlyIfUnchangedSince: nil, announcing: .views)
        case "delete":
            guard let serverId = bucket.serverId else { return try drop(localId, store) }
            guard let projectId = context.projectServerId, let viewId = context.viewServerId else {
                throw ApiError.blocked("bucket: parent view not synced yet")
            }
            try await api.performIgnoring404(.delete, "/projects/\(projectId)/views/\(viewId)/buckets/\(serverId)")
            try drop(localId, store)
        default:
            return
        }
    }

    func body(_ bucket: BucketRecord) -> JSONBody {
        var body: JSONBody = ["title": .string(bucket.title), "limit": .number(Double(bucket.limit))]
        if let position = bucket.position { body["position"] = .number(position) }
        return body
    }

    private func drop(_ localId: String, _ store: CriaStore) throws {
        try store.dropRow(table: "buckets", localId: localId, announcing: [.views],
                          also: [("DELETE FROM task_buckets WHERE bucket_local_id = ?", [localId])])
    }
}

/// Moves a task into a bucket. Payload: `view_local_id`, `bucket_local_id`; the entity is the task.
public struct TaskBucketExecutor: OutboxExecutor {
    public init() {}

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let payload = op.payloadObject
        let context = try store.viewContext(viewLocalId: payload.string("view_local_id") ?? "")
        let taskId = try store.pushTaskServerId(localId: op.entityLocalId)
        let bucketId = try store.pushInt("SELECT server_id FROM buckets WHERE local_id = ?", payload.string("bucket_local_id") ?? "")
        // FIFO keeps the create ops of the task and bucket ahead of this one.
        guard let taskId, let bucketId, let viewId = context.viewServerId, let projectId = context.projectServerId else {
            throw ApiError.blocked("task_bucket: task/bucket not synced yet")
        }
        try await api.moveTaskToBucket(projectId: projectId, viewId: viewId, bucketId: bucketId, [
            "task_id": .number(Double(taskId)),
            "bucket_id": .number(Double(bucketId)),
            "project_view_id": .number(Double(viewId))
        ])
    }
}

/// Sets a task's position in a view. Payload: `view_local_id`, `position`; the entity is the task.
public struct TaskPositionExecutor: OutboxExecutor {
    public init() {}

    public func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        let payload = op.payloadObject
        let context = try store.viewContext(viewLocalId: payload.string("view_local_id") ?? "")
        let taskId = try store.pushTaskServerId(localId: op.entityLocalId)
        guard let taskId, let viewId = context.viewServerId, let position = payload["position"] as? Double else {
            throw ApiError.blocked("task_position: task/view not synced yet")
        }
        try await api.setTaskPosition(id: taskId, [
            "position": .number(position),
            "project_view_id": .number(Double(viewId)),
            "task_id": .number(Double(taskId))
        ])
    }
}
