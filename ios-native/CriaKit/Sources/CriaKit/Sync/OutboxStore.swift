import Foundation
import GRDB

/// One queued write. Mirrors `OutboxRow` in `src/sync/push/shared.ts`.
public struct OutboxRow: Equatable, Sendable {
    public let id: Int
    public let entityType: String
    public let entityLocalId: String
    public let op: String
    public let payload: String
    public let attempts: Int
    public let lastError: String?
    public let nextAttemptAt: String?
    public let createdAt: String

    init(row: Row) {
        id = row["id"]
        entityType = row["entity_type"]
        entityLocalId = row["entity_local_id"]
        op = row["op"]
        payload = row["payload"]
        attempts = row["attempts"]
        lastError = row["last_error"]
        nextAttemptAt = row["next_attempt_at"]
        createdAt = row["created_at"]
    }

    /// The payload as a JSON object, or empty when it is not one.
    public var payloadObject: [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any]) ?? [:]
    }
}

public struct DeadLetterRow: Equatable, Sendable {
    public let id: Int
    public let entityType: String
    public let entityLocalId: String
    public let op: String
    public let payload: String
    public let attempts: Int
    public let lastError: String?
    public let failedAt: String

    init(row: Row) {
        id = row["id"]
        entityType = row["entity_type"]
        entityLocalId = row["entity_local_id"]
        op = row["op"]
        payload = row["payload"]
        attempts = row["attempts"]
        lastError = row["last_error"]
        failedAt = row["failed_at"]
    }
}

/// Outbox persistence used by the drain loop and the "stuck ops" screen.
extension CriaStore {
    public func outboxRows() throws -> [OutboxRow] {
        try database.writer.read { try Row.fetchAll($0, sql: "SELECT * FROM outbox ORDER BY id ASC").map(OutboxRow.init(row:)) }
    }

    /// How many changes are waiting, without loading their payloads.
    public func outboxCount() throws -> Int {
        try database.writer.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM outbox") ?? 0 }
    }

    /// Always the oldest row, regardless of `next_attempt_at`: skipping a backing-off head would break FIFO.
    public func outboxHead() throws -> OutboxRow? {
        try database.writer.read { try Row.fetchOne($0, sql: "SELECT * FROM outbox ORDER BY id ASC LIMIT 1").map(OutboxRow.init(row:)) }
    }

    public func deadLetters() throws -> [DeadLetterRow] {
        try database.writer.read {
            try Row.fetchAll($0, sql: "SELECT * FROM outbox_dead_letter ORDER BY id ASC").map(DeadLetterRow.init(row:))
        }
    }

    /// Drain success: remove the op and announce `outbox`.
    func completeOutboxRow(id: Int) throws {
        try userWrite(announcing: [.outbox]) { try $0.execute(sql: "DELETE FROM outbox WHERE id = ?", arguments: [id]) }
    }

    /// Drain failure with budget left: record the attempt and when to retry. Silent.
    func recordOutboxFailure(id: Int, attempts: Int, error: String, nextAttemptAt: String) throws {
        try database.writer.write {
            try $0.execute(
                sql: "UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?",
                arguments: [attempts, error, nextAttemptAt, id]
            )
        }
    }

    /// Drain failure without budget (or not retryable): move the op to the dead-letter table.
    func deadLetterOutboxRow(_ row: OutboxRow, attempts: Int, error: String, at now: String) throws {
        try userWrite(announcing: [.outbox]) { connection in
            try connection.execute(sql: """
                INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, last_error, failed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, arguments: [row.entityType, row.entityLocalId, row.op, row.payload, attempts, error, now])
            try connection.execute(sql: "DELETE FROM outbox WHERE id = ?", arguments: [row.id])
        }
    }

    /// Crash idempotency: a create succeeded but the app may die before the server id is saved locally, so the
    /// id is cached in the payload and the retry skips the API call.
    func cacheCreateResponse(opId: Int, payload: String, serverId: Int?) throws {
        guard let serverId, var object = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] else { return }
        object["_cachedServerId"] = serverId
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try database.writer.write {
            try $0.execute(sql: "UPDATE outbox SET payload = ? WHERE id = ?", arguments: [String(bytes: data, encoding: .utf8) ?? "", opId])
        }
    }

    /// Moves a dead-lettered op back to the live outbox with attempts and backoff reset.
    @discardableResult
    public func retryDeadLetter(id: Int) throws -> Bool {
        try userWrite(announcing: [.outbox]) { connection in
            guard let row = try Row.fetchOne(connection, sql: "SELECT * FROM outbox_dead_letter WHERE id = ?", arguments: [id]) else {
                return false
            }
            let dead = DeadLetterRow(row: row)
            try connection.execute(sql: """
                INSERT INTO outbox (entity_type, entity_local_id, op, payload, attempts, last_error, next_attempt_at, created_at)
                VALUES (?, ?, ?, ?, 0, ?, NULL, ?)
                """, arguments: [dead.entityType, dead.entityLocalId, dead.op, dead.payload, dead.lastError, isoNow()])
            try connection.execute(sql: "DELETE FROM outbox_dead_letter WHERE id = ?", arguments: [id])
            return true
        }
    }

    /// Deliberate escape hatch for a wedged head op. The local entity stays as it is.
    public func discardOutboxOp(id: Int) throws {
        try userWrite(announcing: [.outbox]) { try $0.execute(sql: "DELETE FROM outbox WHERE id = ?", arguments: [id]) }
    }

    public func discardDeadLetter(id: Int) throws {
        try userWrite(announcing: [.outbox]) { try $0.execute(sql: "DELETE FROM outbox_dead_letter WHERE id = ?", arguments: [id]) }
    }

    public func clearDeadLetters() throws {
        try userWrite(announcing: [.outbox]) { try $0.execute(sql: "DELETE FROM outbox_dead_letter") }
    }
}
