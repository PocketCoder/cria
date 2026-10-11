import Foundation
import GRDB

/// Shared local-row bookkeeping for the push executors. Table names are internal constants, never user input.
extension CriaStore {
    func pushRow(_ sql: String, _ localId: String) throws -> Row? {
        try database.writer.read { try Row.fetchOne($0, sql: sql, arguments: [localId]) }
    }

    func pushInt(_ sql: String, _ localId: String) throws -> Int? {
        try database.writer.read { try Int.fetchOne($0, sql: sql, arguments: [localId]) }
    }

    /// Hard-deletes one row (and any extra statements) and announces.
    func dropRow(table: String, localId: String, announcing kinds: [ChangeKind], also extra: [(String, [String])] = []) throws {
        try userWrite(announcing: kinds) { connection in
            for (sql, arguments) in extra {
                try connection.execute(sql: sql, arguments: StatementArguments(arguments))
            }
            try connection.execute(sql: "DELETE FROM \(table) WHERE local_id = ?", arguments: [localId])
        }
    }

    /// Create succeeded (or its id was cached). `onlyIfUnchangedSince` keeps `dirty` when the user edited the row
    /// while the request was in flight, so that edit still pushes.
    func markCreated(table: String, localId: String, serverId: Int?, updatedAt: String?, onlyIfUnchangedSince: String?,
                     announcing kind: ChangeKind) throws {
        let now = isoNow()
        try userWrite(announcing: [kind]) { connection in
            var sql = "UPDATE \(table) SET server_id = ?, synced_at = ?, dirty = 0"
            var arguments: [(any DatabaseValueConvertible)?] = [serverId, now]
            if let updatedAt {
                sql += ", updated_at = ?"
                arguments.append(updatedAt)
            }
            sql += " WHERE local_id = ?"
            arguments.append(localId)
            if let onlyIfUnchangedSince {
                sql += " AND updated_at = ?"
                arguments.append(onlyIfUnchangedSince)
            }
            try connection.execute(sql: sql, arguments: StatementArguments(arguments))
        }
    }

    /// Update succeeded.
    func markPushed(table: String, localId: String, updatedAt: String?, onlyIfUnchangedSince: String?,
                    announcing kind: ChangeKind) throws {
        let now = isoNow()
        try userWrite(announcing: [kind]) { connection in
            var sql = "UPDATE \(table) SET synced_at = ?, dirty = 0"
            var arguments: [(any DatabaseValueConvertible)?] = [now]
            if let updatedAt {
                sql += ", updated_at = ?"
                arguments.append(updatedAt)
            }
            sql += " WHERE local_id = ?"
            arguments.append(localId)
            if let onlyIfUnchangedSince {
                sql += " AND updated_at = ?"
                arguments.append(onlyIfUnchangedSince)
            }
            try connection.execute(sql: sql, arguments: StatementArguments(arguments))
        }
    }
}

func stripHash(_ color: String?) -> String? {
    guard var color, !color.isEmpty else { return nil }
    if color.hasPrefix("#") { color.removeFirst() }
    return color.isEmpty ? nil : color
}

func jsonValue(parsing text: String?) -> JSONValue? {
    guard let text, !text.isEmpty else { return nil }
    return try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
}
