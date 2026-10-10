import Foundation
import GRDB

/// A kanban bucket row. Ported from `Bucket` in `src/domain/bucket.ts`.
public struct BucketRecord: Equatable, Sendable {
    public let localId: String
    public let serverId: Int?
    public let viewLocalId: String
    public let title: String
    public let position: Double?
    public let limit: Int
    public let createdByServerId: Int?
    public let updatedAt: String

    init(row: Row) {
        localId = row["local_id"]
        serverId = row["server_id"]
        viewLocalId = row["view_local_id"]
        title = row["title"]
        position = row["position"]
        limit = row["task_limit"]
        createdByServerId = row["created_by_server_id"]
        updatedAt = row["updated_at"]
    }
}

/// A task's bucket and its position within that bucket, for one kanban view.
public struct TaskBucketRecord: Equatable, Sendable {
    public let taskLocalId: String
    public let viewLocalId: String
    public let bucketLocalId: String
    public let position: Double?

    init(row: Row) {
        taskLocalId = row["task_local_id"]
        viewLocalId = row["view_local_id"]
        bucketLocalId = row["bucket_local_id"]
        position = row["position"]
    }
}

public struct BucketInput: Sendable {
    public var title: String
    public var viewLocalId: String
    public var position: Double?
    public var limit: Int?

    public init(title: String, viewLocalId: String, position: Double? = nil, limit: Int? = nil) {
        self.title = title
        self.viewLocalId = viewLocalId
        self.position = position
        self.limit = limit
    }
}

/// Partial bucket edit. A nil field is left unchanged.
public struct BucketUpdate: Sendable {
    public var title: String?
    public var position: Double?
    public var limit: Int?

    public init(title: String? = nil, position: Double? = nil, limit: Int? = nil) {
        self.title = title
        self.position = position
        self.limit = limit
    }
}

extension CriaStore {
    static let bucketColumns = "local_id, server_id, view_local_id, title, position, task_limit, created_by_server_id, updated_at"

    // MARK: Reads

    public func buckets(forView viewLocalId: String) throws -> [BucketRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.bucketColumns) FROM buckets
                 WHERE view_local_id = ? AND deleted = 0
                 ORDER BY position IS NULL, position ASC
                """, arguments: [viewLocalId]).map(BucketRecord.init(row:))
        }
    }

    public func bucket(localId: String) throws -> BucketRecord? {
        try database.writer.read { connection in
            try CriaStore.fetchBucket(connection, localId: localId)
        }
    }

    static func fetchBucket(_ connection: Database, localId: String) throws -> BucketRecord? {
        try Row.fetchOne(connection, sql: """
            SELECT \(bucketColumns) FROM buckets WHERE local_id = ? AND deleted = 0
            """, arguments: [localId]).map(BucketRecord.init(row:))
    }

    public func bucketAssignments(forView viewLocalId: String) throws -> [TaskBucketRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT task_local_id, view_local_id, bucket_local_id, position FROM task_buckets
                 WHERE view_local_id = ?
                 ORDER BY position IS NULL, position ASC
                """, arguments: [viewLocalId]).map(TaskBucketRecord.init(row:))
        }
    }

    // MARK: Sync path (silent)

    /// Silent server merge for one bucket, keyed by server id. A dirty row is left alone. Returns the local id.
    @discardableResult
    public func upsertBucketFromServer(_ payload: BucketResponse, rawJSON: String) throws -> String {
        try database.writer.write { connection in
            try CriaStore.mergeBucket(connection, payload: payload, rawJSON: rawJSON)
        }
    }

    /// Silent: upserts each bucket, then soft-deletes clean local buckets of the view the server did not return.
    /// Dirty rows are spared, so a new bucket that has not pushed yet survives a pull.
    public func replaceBucketsForViewFromServer(
        viewLocalId: String, _ payloads: [(payload: BucketResponse, rawJSON: String)]
    ) throws {
        try database.writer.write { connection -> Void in
            var upserted: [String] = []
            for item in payloads {
                upserted.append(try CriaStore.mergeBucket(connection, payload: item.payload, rawJSON: item.rawJSON))
            }
            guard !upserted.isEmpty else { return }
            try connection.execute(sql: """
                UPDATE buckets SET deleted = 1, updated_at = ?
                 WHERE view_local_id = ? AND local_id NOT IN (\(sqlPlaceholders(upserted.count)))
                   AND deleted = 0 AND dirty = 0
                """, arguments: sqlArguments([isoNow(), viewLocalId] + upserted))
        }
    }

    static func mergeBucket(_ connection: Database, payload: BucketResponse, rawJSON: String) throws -> String {
        guard let viewLocalId = try String.fetchOne(
            connection, sql: "SELECT local_id FROM project_views WHERE server_id = ? LIMIT 1", arguments: [payload.projectViewId]
        ) else {
            throw ViewError.parentNotFound(payload.projectViewId)
        }
        let now = isoNow()
        let updatedAt = payload.updated ?? now
        let existing = try Row.fetchOne(
            connection, sql: "SELECT local_id, dirty, last_synced FROM buckets WHERE server_id = ?", arguments: [payload.id]
        )
        guard let existing else {
            let localId = UUID().uuidString
            try connection.execute(sql: """
                INSERT INTO buckets (local_id, server_id, view_local_id, title, position, task_limit,
                       created_by_server_id, updated_at, synced_at, last_synced, dirty, deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                """, arguments: [
                    localId, payload.id, viewLocalId, payload.title, payload.position ?? 0, payload.limit ?? 0,
                    payload.createdById, updatedAt, now, rawJSON
                ])
            return localId
        }
        let localId: String = existing["local_id"]
        let dirty: Bool = existing["dirty"]
        if dirty {
            let lastSynced: String? = existing["last_synced"]
            try CriaStore.recordSyncConflict(
                connection, entity: "bucket", localId: localId, lastSynced: lastSynced, remoteJSON: rawJSON
            )
            return localId
        }
        try connection.execute(sql: """
            UPDATE buckets SET title = ?, position = ?, task_limit = ?, updated_at = ?, synced_at = ?,
                   last_synced = ?, dirty = 0, deleted = 0
             WHERE local_id = ? AND deleted = 0 AND dirty = 0
            """, arguments: [payload.title, payload.position ?? 0, payload.limit ?? 0, updatedAt, now, rawJSON, localId])
        return localId
    }

    /// Silent: records the server's task-to-bucket assignments for a view. Pairs whose task or bucket is not
    /// known locally are skipped. Like the TypeScript version, this resets the stored position to 0.
    public func replaceBucketAssignmentsFromServer(
        viewLocalId: String, _ assignments: [(taskServerId: Int, bucketServerId: Int)]
    ) throws {
        try database.writer.write { connection -> Void in
            for item in assignments {
                let taskLocalId = try String.fetchOne(
                    connection, sql: "SELECT local_id FROM tasks WHERE server_id = ? LIMIT 1", arguments: [item.taskServerId]
                )
                let bucketLocalId = try String.fetchOne(
                    connection, sql: "SELECT local_id FROM buckets WHERE server_id = ? LIMIT 1", arguments: [item.bucketServerId]
                )
                guard let taskLocalId, let bucketLocalId else { continue }
                try connection.execute(sql: """
                    INSERT OR REPLACE INTO task_buckets (task_local_id, view_local_id, bucket_local_id)
                    VALUES (?, ?, ?)
                    """, arguments: [taskLocalId, viewLocalId, bucketLocalId])
            }
        }
    }

    // MARK: User mutations: task placement

    /// Moves a task into a bucket for a kanban view, replacing any earlier assignment. Position defaults to 0.
    public func setTaskBucket(taskLocalId: String, viewLocalId: String, bucketLocalId: String, position: Double? = nil) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            try connection.execute(sql: """
                INSERT OR REPLACE INTO task_buckets (task_local_id, view_local_id, bucket_local_id, position)
                VALUES (?, ?, ?, ?)
                """, arguments: [taskLocalId, viewLocalId, bucketLocalId, position ?? 0])
            try connection.enqueue(
                .taskBucket,
                localId: taskLocalId,
                operation: .update,
                payload: ["view_local_id": viewLocalId, "bucket_local_id": bucketLocalId],
                at: isoNow()
            )
        }
    }

    /// Sets a task's position in its current bucket and queues a `task_position` update.
    public func updateTaskPosition(taskLocalId: String, viewLocalId: String, position: Double) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            try connection.execute(
                sql: "UPDATE task_buckets SET position = ? WHERE task_local_id = ? AND view_local_id = ?",
                arguments: [position, taskLocalId, viewLocalId]
            )
            try connection.enqueue(
                .taskPosition,
                localId: taskLocalId,
                operation: .update,
                payload: ["view_local_id": viewLocalId, "position": position],
                at: isoNow()
            )
        }
    }

    /// Gives every task in the list an evenly spaced position, in order. Upserts the assignment so tasks that were
    /// only implicitly in the bucket (the unplaced-to-default fallback) get a real row and do not snap back.
    public func reorderTasksInBucket(
        viewLocalId: String, bucketLocalId: String, orderedTaskIds: [String], baseStep: Double = 1024
    ) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            for (index, taskLocalId) in orderedTaskIds.enumerated() {
                let position = Double(index + 1) * baseStep
                try connection.execute(sql: """
                    INSERT OR REPLACE INTO task_buckets (task_local_id, view_local_id, bucket_local_id, position)
                    VALUES (?, ?, ?, ?)
                    """, arguments: [taskLocalId, viewLocalId, bucketLocalId, position])
                try connection.enqueue(
                    .taskPosition,
                    localId: taskLocalId,
                    operation: .update,
                    payload: ["view_local_id": viewLocalId, "position": position],
                    at: now
                )
            }
        }
    }

    // MARK: User mutations: buckets

    @discardableResult
    public func createBucket(_ input: BucketInput) throws -> BucketRecord {
        try userWrite(announcing: [.views, .outbox]) { connection in
            let localId = UUID().uuidString
            let now = isoNow()
            let maxPosition = try Double.fetchOne(connection, sql: """
                SELECT MAX(position) FROM buckets WHERE view_local_id = ? AND deleted = 0
                """, arguments: [input.viewLocalId])
            let position = input.position ?? (maxPosition ?? 0) + 1024
            try connection.execute(sql: """
                INSERT INTO buckets (local_id, server_id, view_local_id, title, position, task_limit,
                       updated_at, dirty, deleted)
                VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 0)
                """, arguments: [localId, input.viewLocalId, input.title, position, input.limit ?? 0, now])
            var payload: [String: Any] = ["title": input.title, "viewLocalId": input.viewLocalId]
            if let value = input.position { payload["position"] = value }
            if let value = input.limit { payload["limit"] = value }
            try connection.enqueue(.bucket, localId: localId, operation: .create, payload: payload, at: now)
            guard let created = try CriaStore.fetchBucket(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            return created
        }
    }

    @discardableResult
    public func updateBucket(localId: String, _ update: BucketUpdate) throws -> BucketRecord {
        try userWrite(announcing: [.views, .outbox]) { connection in
            guard try CriaStore.fetchBucket(connection, localId: localId) != nil else {
                throw CriaStoreError.notFound(localId)
            }
            var assignments: [String] = []
            var arguments: [(any DatabaseValueConvertible)?] = []
            var payload: [String: Any] = [:]
            if let title = update.title {
                assignments.append("title = ?")
                arguments.append(title)
                payload["title"] = title
            }
            if let position = update.position {
                assignments.append("position = ?")
                arguments.append(position)
                payload["position"] = position
            }
            if let limit = update.limit {
                assignments.append("task_limit = ?")
                arguments.append(limit)
                payload["limit"] = limit
            }
            if !assignments.isEmpty {
                let now = isoNow()
                assignments += ["updated_at = ?", "dirty = 1"]
                arguments.append(now)
                arguments.append(localId)
                try connection.execute(
                    sql: "UPDATE buckets SET \(assignments.joined(separator: ", ")) WHERE local_id = ?",
                    arguments: StatementArguments(arguments)
                )
                try connection.enqueue(.bucket, localId: localId, operation: .update, payload: payload, at: now)
            }
            guard let updated = try CriaStore.fetchBucket(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            return updated
        }
    }

    /// Soft delete. The row stays until the outbox drains, so the delete can be pushed.
    public func deleteBucket(localId: String) throws {
        try userWrite(announcing: [.views, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE buckets SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?",
                arguments: [now, localId]
            )
            try connection.enqueue(.bucket, localId: localId, operation: .delete, payload: [:], at: now)
        }
    }
}
