import Foundation
import GRDB

/// A project view row. Ported from `ProjectView` in `src/domain/view.ts`.
public struct ViewRecord: Equatable, Sendable {
    public let localId: String
    public let serverId: Int?
    public let projectLocalId: String
    public let title: String
    public let viewKind: ViewResponse.ViewKind
    public let position: Double?
    public let filter: String?
    public let bucketConfigurationMode: ViewResponse.BucketConfigMode
    public let bucketConfiguration: String?
    public let defaultBucketServerId: Int?
    public let doneBucketServerId: Int?
    public let updatedAt: String
    /// A local default view with no server id and no pending create. Edits to it could never be pushed.
    public let placeholder: Bool

    init(row: Row) {
        let kind: String = row["view_kind"]
        let mode: String = row["bucket_configuration_mode"]
        localId = row["local_id"]
        serverId = row["server_id"]
        projectLocalId = row["project_local_id"]
        title = row["title"]
        viewKind = ViewResponse.ViewKind(rawValue: kind) ?? .list
        position = row["position"]
        filter = row["filter"]
        bucketConfigurationMode = ViewResponse.BucketConfigMode(rawValue: mode) ?? .none
        bucketConfiguration = row["bucket_configuration"]
        defaultBucketServerId = row["default_bucket_server_id"]
        doneBucketServerId = row["done_bucket_server_id"]
        updatedAt = row["updated_at"]
        placeholder = row["placeholder"]
    }
}

/// Fields for a new view.
public struct ViewInput: Sendable {
    public var title: String
    public var viewKind: ViewResponse.ViewKind
    public var position: Double?
    public var filter: String?
    public var bucketConfigurationMode: ViewResponse.BucketConfigMode?
    public var bucketConfiguration: String?

    public init(title: String, viewKind: ViewResponse.ViewKind, position: Double? = nil, filter: String? = nil,
                bucketConfigurationMode: ViewResponse.BucketConfigMode? = nil, bucketConfiguration: String? = nil) {
        self.title = title
        self.viewKind = viewKind
        self.position = position
        self.filter = filter
        self.bucketConfigurationMode = bucketConfigurationMode
        self.bucketConfiguration = bucketConfiguration
    }
}

/// Partial view edit. A nil field is left unchanged. For the nullable fields the outer optional means
/// "change it" and the inner one is the new value, so `.some(nil)` clears it.
public struct ViewUpdate: Sendable {
    public var title: String?
    public var position: Double?
    public var filter: String??
    public var bucketConfigurationMode: ViewResponse.BucketConfigMode?
    public var bucketConfiguration: String??
    /// Server id of the bucket tasks are marked done in.
    public var doneBucketServerId: Int??
    /// Server id of the bucket new or unbucketed tasks land in.
    public var defaultBucketServerId: Int??

    public init(title: String? = nil, position: Double? = nil, filter: String?? = nil,
                bucketConfigurationMode: ViewResponse.BucketConfigMode? = nil, bucketConfiguration: String?? = nil,
                doneBucketServerId: Int?? = nil, defaultBucketServerId: Int?? = nil) {
        self.title = title
        self.position = position
        self.filter = filter
        self.bucketConfigurationMode = bucketConfigurationMode
        self.bucketConfiguration = bucketConfiguration
        self.doneBucketServerId = doneBucketServerId
        self.defaultBucketServerId = defaultBucketServerId
    }
}

public enum ViewError: Error, Equatable {
    /// The view is a local default that has not synced yet (`PlaceholderViewError` in TypeScript).
    case placeholder
    /// A project must keep at least one view.
    case lastView
    /// The parent project (or view) is not known locally. Carries its server id.
    case parentNotFound(Int)
}

/// One of the local default views seeded by `createDefaultViews`.
struct DefaultViewSpec: Sendable {
    let title: String
    let kind: ViewResponse.ViewKind
    let position: Double
    let mode: String
}

/// SET clauses, arguments and outbox payload for the fields a `ViewUpdate` changes.
struct ViewAssignments {
    var assignments: [String] = []
    var arguments: [(any DatabaseValueConvertible)?] = []
    var payload: [String: Any] = [:]
}

extension JSONValue {
    /// Plain Foundation value, for `JSONSerialization`.
    var foundationValue: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let value): return value
        case .number(let value): return value
        case .string(let value): return value
        case .array(let values): return values.map(\.foundationValue)
        case .object(let values): return values.mapValues(\.foundationValue)
        }
    }
}

/// `?, ?, ?` for an `IN (...)` list.
func sqlPlaceholders(_ count: Int) -> String {
    Array(repeating: "?", count: count).joined(separator: ", ")
}

func sqlArguments(_ values: [String]) -> StatementArguments {
    let converted: [(any DatabaseValueConvertible)?] = values.map { $0 as (any DatabaseValueConvertible)? }
    return StatementArguments(converted)
}

extension CriaStore {
    /// No server id and no pending create: a local default seeded by `createDefaultViews`.
    static let viewPlaceholderCondition = """
        (server_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM outbox o
             WHERE o.entity_type = 'view' AND o.op = 'create'
               AND o.entity_local_id = project_views.local_id))
        """

    static let viewColumns = """
        local_id, server_id, project_local_id, title, view_kind, position, filter, \
        bucket_configuration_mode, bucket_configuration, default_bucket_server_id, \
        done_bucket_server_id, updated_at, \(viewPlaceholderCondition) AS placeholder
        """

    /// Vikunja creates these four for every project. Mirrored locally as a fallback.
    static let defaultViews: [DefaultViewSpec] = [
        DefaultViewSpec(title: "List", kind: .list, position: 0, mode: "none"),
        DefaultViewSpec(title: "Gantt", kind: .gantt, position: 1, mode: "none"),
        DefaultViewSpec(title: "Table", kind: .table, position: 2, mode: "none"),
        DefaultViewSpec(title: "Kanban", kind: .kanban, position: 3, mode: "manual")
    ]

    // MARK: Reads

    public func views(forProject projectLocalId: String) throws -> [ViewRecord] {
        try database.writer.read { connection in
            try CriaStore.fetchViews(connection, projectLocalId: projectLocalId)
        }
    }

    public func view(localId: String) throws -> ViewRecord? {
        try database.writer.read { connection in
            try CriaStore.fetchView(connection, localId: localId)
        }
    }

    static func fetchViews(_ connection: Database, projectLocalId: String) throws -> [ViewRecord] {
        try Row.fetchAll(connection, sql: """
            SELECT \(viewColumns) FROM project_views
             WHERE project_local_id = ? AND deleted = 0
             ORDER BY position IS NULL, position ASC, title COLLATE NOCASE ASC
            """, arguments: [projectLocalId]).map(ViewRecord.init(row:))
    }

    static func fetchView(_ connection: Database, localId: String) throws -> ViewRecord? {
        try Row.fetchOne(connection, sql: """
            SELECT \(viewColumns) FROM project_views WHERE local_id = ? AND deleted = 0
            """, arguments: [localId]).map(ViewRecord.init(row:))
    }

    /// Throws `ViewError.placeholder` if any of the views is a placeholder. Call inside the edit's write.
    static func assertNoPlaceholders(_ connection: Database, _ localIds: [String]) throws {
        guard !localIds.isEmpty else { return }
        let hit = try String.fetchOne(connection, sql: """
            SELECT local_id FROM project_views
             WHERE local_id IN (\(sqlPlaceholders(localIds.count))) AND \(viewPlaceholderCondition)
             LIMIT 1
            """, arguments: sqlArguments(localIds))
        if hit != nil {
            throw ViewError.placeholder
        }
    }

    // MARK: User mutations

    @discardableResult
    public func createView(projectLocalId: String, _ input: ViewInput) throws -> ViewRecord {
        try userWrite(announcing: [.views, .outbox]) { connection in
            let localId = UUID().uuidString
            let now = isoNow()
            let maxPosition = try Double.fetchOne(connection, sql: """
                SELECT MAX(position) FROM project_views WHERE project_local_id = ? AND deleted = 0
                """, arguments: [projectLocalId])
            let position = input.position ?? (maxPosition ?? 0) + 1024
            // Vikunja turns a kanban view's 'none' into 'manual'; mirror it so the row matches before the next pull.
            let defaultMode: ViewResponse.BucketConfigMode = input.viewKind == .kanban ? .manual : .none
            let mode = input.bucketConfigurationMode ?? defaultMode
            try connection.execute(sql: """
                INSERT INTO project_views (local_id, server_id, project_local_id, title, view_kind, position, filter,
                       bucket_configuration_mode, bucket_configuration, updated_at, dirty, deleted)
                VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
                """, arguments: [
                    localId, projectLocalId, input.title, input.viewKind.rawValue, position, input.filter,
                    mode.rawValue, input.bucketConfiguration, now
                ])
            var payload: [String: Any] = ["title": input.title, "viewKind": input.viewKind.rawValue]
            if let value = input.position { payload["position"] = value }
            if let value = input.filter { payload["filter"] = value }
            if let value = input.bucketConfigurationMode { payload["bucketConfigurationMode"] = value.rawValue }
            if let value = input.bucketConfiguration { payload["bucketConfiguration"] = value }
            try connection.enqueue(.view, localId: localId, operation: .create, payload: payload, at: now)
            guard let created = try CriaStore.fetchView(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            return created
        }
    }

    static func viewAssignments(_ update: ViewUpdate) -> ViewAssignments {
        var built = ViewAssignments()
        if let title = update.title {
            built.assignments.append("title = ?")
            built.arguments.append(title)
            built.payload["title"] = title
        }
        if let position = update.position {
            built.assignments.append("position = ?")
            built.arguments.append(position)
            built.payload["position"] = position
        }
        if let filter = update.filter {
            built.assignments.append("filter = ?")
            built.arguments.append(filter)
            built.payload["filter"] = jsonNullable(filter)
        }
        if let mode = update.bucketConfigurationMode {
            built.assignments.append("bucket_configuration_mode = ?")
            built.arguments.append(mode.rawValue)
            built.payload["bucketConfigurationMode"] = mode.rawValue
        }
        if let config = update.bucketConfiguration {
            built.assignments.append("bucket_configuration = ?")
            built.arguments.append(config)
            built.payload["bucketConfiguration"] = jsonNullable(config)
        }
        if let doneBucket = update.doneBucketServerId {
            built.assignments.append("done_bucket_server_id = ?")
            built.arguments.append(doneBucket)
            built.payload["doneBucketServerId"] = jsonNullable(doneBucket)
        }
        if let defaultBucket = update.defaultBucketServerId {
            built.assignments.append("default_bucket_server_id = ?")
            built.arguments.append(defaultBucket)
            built.payload["defaultBucketServerId"] = jsonNullable(defaultBucket)
        }
        return built
    }

    /// Edits a view and queues its update. Throws `ViewError.placeholder` for a local default view.
    @discardableResult
    public func updateView(localId: String, _ update: ViewUpdate) throws -> ViewRecord {
        try userWrite(announcing: [.views, .outbox]) { connection in
            guard try CriaStore.fetchView(connection, localId: localId) != nil else {
                throw CriaStoreError.notFound(localId)
            }
            let built = CriaStore.viewAssignments(update)
            var assignments = built.assignments
            var arguments = built.arguments
            if !assignments.isEmpty {
                try CriaStore.assertNoPlaceholders(connection, [localId])
                let now = isoNow()
                assignments += ["updated_at = ?", "dirty = 1"]
                arguments.append(now)
                arguments.append(localId)
                try connection.execute(
                    sql: "UPDATE project_views SET \(assignments.joined(separator: ", ")) WHERE local_id = ?",
                    arguments: StatementArguments(arguments)
                )
                try connection.enqueue(.view, localId: localId, operation: .update, payload: built.payload, at: now)
            }
            guard let updated = try CriaStore.fetchView(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            return updated
        }
    }

    /// Rewrites positions for an explicit order (`baseStep`, `2 * baseStep`, ...), one outbox update each.
    /// Throws `ViewError.placeholder`, writing nothing, if any of the views is a placeholder.
    public func reindexViews(_ orderedLocalIds: [String], baseStep: Double = 1024) throws {
        guard !orderedLocalIds.isEmpty else { return }
        try userWrite(announcing: [.views, .outbox]) { connection in
            try CriaStore.assertNoPlaceholders(connection, orderedLocalIds)
            let now = isoNow()
            for (index, localId) in orderedLocalIds.enumerated() {
                let position = Double(index + 1) * baseStep
                try connection.execute(
                    sql: "UPDATE project_views SET position = ?, updated_at = ?, dirty = 1 WHERE local_id = ?",
                    arguments: [position, now, localId]
                )
                try connection.enqueue(.view, localId: localId, operation: .update, payload: ["position": position], at: now)
            }
        }
    }

    /// Soft delete. Throws `ViewError.lastView` for a project's only view and `ViewError.placeholder` for a
    /// local default. An unknown view is a no-op.
    public func deleteView(localId: String) throws {
        guard let existing = try view(localId: localId) else { return }
        try userWrite(announcing: [.views, .outbox]) { connection in
            let liveCount = try Int.fetchOne(connection, sql: """
                SELECT COUNT(*) FROM project_views WHERE project_local_id = ? AND deleted = 0
                """, arguments: [existing.projectLocalId]) ?? 0
            if liveCount <= 1 {
                throw ViewError.lastView
            }
            try CriaStore.assertNoPlaceholders(connection, [localId])
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE project_views SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?",
                arguments: [now, localId]
            )
            try connection.enqueue(.view, localId: localId, operation: .delete, payload: [:], at: now)
        }
    }
}
