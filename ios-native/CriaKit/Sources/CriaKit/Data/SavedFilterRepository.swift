import Foundation
import GRDB

/// A saved filter row. Ported from `SavedFilter` in `src/db/savedFilters.ts`.
public struct SavedFilterRecord: Equatable, Sendable {
    public let serverId: Int
    public let title: String
    public let description: String?
    public let filterQuery: String
    public let filterIncludeNulls: Bool
    public let updatedAt: String?

    init(row: Row) {
        serverId = row["server_id"]
        title = row["title"]
        description = row["description"]
        filterQuery = row["filter_query"]
        filterIncludeNulls = row["filter_include_nulls"]
        updatedAt = row["updated_at"]
    }
}

/// The relevant fields of `GET /filters/{id}`.
public struct SavedFilterResponse: Decodable, Equatable, Sendable {
    public struct Filters: Decodable, Equatable, Sendable {
        public let filter: String?
        public let filterIncludeNulls: Bool?

        enum CodingKeys: String, CodingKey {
            case filter
            case filterIncludeNulls = "filter_include_nulls"
        }

        public init(filter: String?, filterIncludeNulls: Bool?) {
            self.filter = filter
            self.filterIncludeNulls = filterIncludeNulls
        }
    }

    public let id: Int?
    public let title: String?
    public let description: String?
    public let filters: Filters?
    public let updated: String?

    public init(id: Int?, title: String?, description: String? = nil, filters: Filters? = nil, updated: String? = nil) {
        self.id = id
        self.title = title
        self.description = description
        self.filters = filters
        self.updated = updated
    }
}

extension CriaStore {
    static let savedFilterColumns = "server_id, title, description, filter_query, filter_include_nulls, updated_at"

    public func savedFilters() throws -> [SavedFilterRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.savedFilterColumns) FROM saved_filters ORDER BY title COLLATE NOCASE ASC
                """).map(SavedFilterRecord.init(row:))
        }
    }

    public func savedFilter(serverId: Int) throws -> SavedFilterRecord? {
        try database.writer.read { connection in
            try Row.fetchOne(connection, sql: """
                SELECT \(CriaStore.savedFilterColumns) FROM saved_filters WHERE server_id = ?
                """, arguments: [serverId]).map(SavedFilterRecord.init(row:))
        }
    }

    /// Silent: inserts or updates by server id. A payload without an id is ignored. The caller announces once
    /// after the pull.
    public func upsertSavedFilterFromServer(_ payload: SavedFilterResponse) throws {
        guard let serverId = payload.id else { return }
        try database.writer.write { connection in
            try connection.execute(sql: """
                INSERT INTO saved_filters (server_id, title, description, filter_query, filter_include_nulls, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (server_id) DO UPDATE SET
                    title = excluded.title,
                    description = excluded.description,
                    filter_query = excluded.filter_query,
                    filter_include_nulls = excluded.filter_include_nulls,
                    updated_at = excluded.updated_at
                """, arguments: [
                    serverId, payload.title ?? "", payload.description, payload.filters?.filter ?? "",
                    payload.filters?.filterIncludeNulls ?? false, payload.updated
                ])
        }
    }

    /// Removes a saved filter after the server delete. Announces the change.
    public func deleteSavedFilter(serverId: Int) throws {
        try userWrite(announcing: [.savedFilters]) { connection in
            try connection.execute(sql: "DELETE FROM saved_filters WHERE server_id = ?", arguments: [serverId])
        }
    }

    /// Silent: removes rows whose server id is not in `keepServerIds` (sync reconcile). An empty list removes all.
    public func pruneSavedFilters(keeping keepServerIds: [Int]) throws {
        try database.writer.write { connection -> Void in
            if keepServerIds.isEmpty {
                try connection.execute(sql: "DELETE FROM saved_filters")
            } else {
                let arguments: [(any DatabaseValueConvertible)?] = keepServerIds.map { $0 as (any DatabaseValueConvertible)? }
                try connection.execute(
                    sql: "DELETE FROM saved_filters WHERE server_id NOT IN (\(sqlPlaceholders(keepServerIds.count)))",
                    arguments: StatementArguments(arguments)
                )
            }
        }
    }
}
