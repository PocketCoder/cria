import Foundation
import GRDB

extension ApiError {
    /// An op blocked on a parent that has no server id yet. Retryable, and it does not use up an attempt.
    static func blocked(_ message: String) -> ApiError {
        ApiError(status: 408, code: nil, message: message, retryable: true, dependency: true)
    }
}

extension ApiClient {
    /// Sends the request and treats 404 as success (the entity is already gone). Other errors throw.
    func performIgnoring404(_ method: HTTPMethod, _ path: String, body: (any Encodable & Sendable)? = nil) async throws {
        do {
            try await perform(method, path, body: body)
        } catch let error as ApiError where error.status == 404 {
            return
        }
    }
}

extension Dictionary where Key == String, Value == Any {
    func string(_ keys: String...) -> String? {
        for key in keys { if let value = self[key] as? String { return value } }
        return nil
    }

    func int(_ keys: String...) -> Int? {
        for key in keys { if let value = self[key] as? Int { return value } }
        return nil
    }
}

/// Reads a cached server id from a create op's payload (see `CriaStore.cacheCreateResponse`).
func cachedCreateResponse(_ payload: String) -> Int? {
    guard let object = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] else { return nil }
    return object["_cachedServerId"] as? Int
}

func jsonValuesEqual(_ lhs: Any?, _ rhs: Any?) -> Bool {
    let left = lhs ?? NSNull()
    let right = rhs ?? NSNull()
    return (left as AnyObject).isEqual(right)
}

extension CriaStore {
    /// Pre-push divergence check. Compares the server's current payload with the `last_synced` snapshot on the
    /// conflict fields; on a difference records a conflict and returns true, and the caller must abort the push so
    /// the user can resolve before the server's version is overwritten. Ported from `checkDivergence`.
    func checkDivergence(lastSynced: String?, serverPayload: Data, fields: [String], entityType: String, localId: String) throws -> Bool {
        guard let lastSynced,
              let before = try? JSONSerialization.jsonObject(with: Data(lastSynced.utf8)) as? [String: Any],
              let after = try? JSONSerialization.jsonObject(with: serverPayload) as? [String: Any] else { return false }
        let diverged = fields.filter { !jsonValuesEqual(before[$0], after[$0]) }
        guard !diverged.isEmpty else { return false }
        let fieldsJSON = String(bytes: try JSONSerialization.data(withJSONObject: diverged), encoding: .utf8) ?? ""
        let remoteText = String(bytes: serverPayload, encoding: .utf8) ?? ""
        try userWrite(announcing: [.conflicts]) { connection in
            try connection.execute(sql: """
                INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, arguments: [entityType, localId, fieldsJSON, lastSynced, remoteText, isoNow()])
        }
        return true
    }

    func hasUnresolvedConflict(entityType: String, localId: String) throws -> Bool {
        try database.writer.read { connection in
            try Bool.fetchOne(connection, sql: """
                SELECT EXISTS(SELECT 1 FROM conflicts WHERE entity_type = ? AND entity_local_id = ? AND resolved_at IS NULL)
                """, arguments: [entityType, localId]) ?? false
        }
    }
}
