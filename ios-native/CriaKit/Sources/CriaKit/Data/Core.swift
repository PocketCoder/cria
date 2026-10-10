import Foundation
import GRDB

/// Owns the SQLite connection and applies migrations on open. The app passes a file in the
/// App Group container (S-00 decision); tests pass an in-memory queue.
public final class CriaDatabase: Sendable {
    let writer: any DatabaseWriter

    public init(writer: any DatabaseWriter) throws {
        self.writer = writer
        try CriaMigrations.migrate(writer)
    }

    public static func inMemory() throws -> CriaDatabase {
        try CriaDatabase(writer: DatabaseQueue())
    }
}

/// Kinds of change announced to observers. Only user mutations publish these.
public enum ChangeKind: String, Sendable, CaseIterable {
    case projects, tasks, labels, outbox
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
}

enum OutboxOp: String, Sendable {
    case create, update, delete
}

extension Database {
    /// Queues a change for the push engine. Call inside the same write as the row change.
    func enqueue(_ entity: OutboxEntity, localId: String, op: OutboxOp, payload: [String: Any], at now: String) throws {
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let json = String(decoding: data, as: UTF8.self)
        try execute(
            sql: "INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            arguments: [entity.rawValue, localId, op.rawValue, json, now]
        )
    }
}
