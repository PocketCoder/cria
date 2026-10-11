import Foundation
import GRDB

/// Owns the SQLite connection and applies migrations on open. The app passes a file in the
/// App Group container (S-00 decision); tests pass an in-memory queue.
public final class CriaDatabase: Sendable {
    let writer: any DatabaseWriter

    /// `migrate: false` is for the share extension, widget and intents: only the app changes the schema, so a second
    /// process never takes the write lock just to open the file.
    public init(writer: any DatabaseWriter, migrate: Bool = true) throws {
        self.writer = writer
        if migrate { try CriaMigrations.migrate(writer) }
    }

    public static func inMemory() throws -> CriaDatabase {
        try CriaDatabase(writer: DatabaseQueue())
    }

    /// How long a process waits for another's write lock before giving up. The app, the share extension, the widget
    /// and the intents all use one file in the App Group, and the default is to fail at once with "database is locked".
    static let busyTimeout: TimeInterval = 5

    /// Opens (creating if needed) the on-disk database, in WAL mode so reads never block the writer. Extensions pass
    /// `migrate: false`; the widget also passes `readOnly: true`.
    public static func open(at url: URL, migrate: Bool = true, readOnly: Bool = false) throws -> CriaDatabase {
        var configuration = Configuration()
        configuration.busyMode = .timeout(busyTimeout)
        configuration.readonly = readOnly
        // Lets `suspend()` release the file before iOS suspends the app: a suspended process holding a lock in a
        // shared container is killed (0xdead10cc).
        configuration.observesSuspensionNotifications = true
        if !readOnly {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        }
        return try CriaDatabase(writer: DatabasePool(path: url.path, configuration: configuration), migrate: migrate)
    }

    /// Call when the app enters the background and again when it returns. While suspended, database access fails
    /// fast instead of holding the shared file.
    public static func suspend() { NotificationCenter.default.post(name: Database.suspendNotification, object: nil) }
    public static func resume() { NotificationCenter.default.post(name: Database.resumeNotification, object: nil) }
}

/// Kinds of change announced to observers. Only user mutations publish these.
public enum ChangeKind: String, Sendable, CaseIterable {
    case projects, tasks, labels, outbox, views, comments, savedFilters, conflicts
}

/// Change notifications. Sync upserts never call `notify` (AGENTS.md: infinite-loop footgun).
public final class ChangeBus: @unchecked Sendable {
    private let lock = NSLock()
    private var subscribers: [UUID: AsyncStream<ChangeKind>.Continuation] = [:]

    public init() {}

    public func subscribe() -> AsyncStream<ChangeKind> {
        let (stream, continuation) = AsyncStream.makeStream(of: ChangeKind.self)
        let id = UUID()
        lock.withLock { subscribers[id] = continuation }
        continuation.onTermination = { [weak self] _ in
            self?.remove(id)
        }
        return stream
    }

    public func notify(_ kind: ChangeKind) {
        let current = lock.withLock { Array(subscribers.values) }
        for continuation in current {
            continuation.yield(kind)
        }
    }

    private func remove(_ id: UUID) {
        lock.withLock { subscribers[id] = nil }
    }
}

public enum CriaStoreError: Error, Equatable {
    case notFound(String)
}

/// Repository entry point. Repositories are extensions on this type, grouped by entity.
public final class CriaStore: Sendable {
    public let database: CriaDatabase
    public let bus: ChangeBus

    public init(database: CriaDatabase, bus: ChangeBus = ChangeBus()) {
        self.database = database
        self.bus = bus
    }

    /// User mutation: one serialised transaction, then announce the listed kinds.
    @discardableResult
    func userWrite<T>(announcing kinds: [ChangeKind], _ body: (Database) throws -> T) throws -> T {
        let result = try database.writer.write(body)
        for kind in kinds {
            bus.notify(kind)
        }
        return result
    }
}

func isoNow() -> String {
    Date().formatted(.iso8601)
}

/// Converts an optional value to `Any`, using NSNull for nil so JSONSerialization accepts it.
func jsonNullable<T>(_ value: T?) -> Any {
    value.map { $0 as Any } ?? NSNull()
}

enum OutboxEntity: String, Sendable {
    case project, task, label, taskLabel = "task_label"
    case view, bucket
    case taskBucket = "task_bucket"
    case taskPosition = "task_position"
    case taskComment = "task_comment"
    case taskAttachment = "task_attachment"
    case taskRelation = "task_relation"
}

enum OutboxOp: String, Sendable {
    case create, update, delete, upload, add, remove
}

extension Database {
    /// Queues a change for the push engine. Call inside the same write as the row change.
    func enqueue(_ entity: OutboxEntity, localId: String, operation: OutboxOp, payload: [String: Any], at now: String) throws {
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let json = String(bytes: data, encoding: .utf8) ?? "{}"
        try execute(
            sql: "INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            arguments: [entity.rawValue, localId, operation.rawValue, json, now]
        )
    }
}
