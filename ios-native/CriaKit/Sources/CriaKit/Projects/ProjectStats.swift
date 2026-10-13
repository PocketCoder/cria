import Foundation
import GRDB

extension CriaStore {
    /// Open (not done, not deleted) task count per project local id. Projects with none are absent.
    public func openTaskCounts() throws -> [String: Int] {
        try database.writer.read { connection in
            var counts: [String: Int] = [:]
            let rows = try Row.fetchAll(connection, sql: """
                SELECT project_local_id, COUNT(*) AS total FROM tasks
                 WHERE done = 0 AND deleted = 0 GROUP BY project_local_id
                """)
            for row in rows {
                let projectId: String = row["project_local_id"]
                counts[projectId] = row["total"]
            }
            return counts
        }
    }

    public func favouriteTaskCount() throws -> Int {
        try database.writer.read { connection in
            try Int.fetchOne(
                connection, sql: "SELECT COUNT(*) FROM tasks WHERE is_favorite = 1 AND done = 0 AND deleted = 0"
            ) ?? 0
        }
    }
}

public extension ProjectTree {
    /// Collapsed ids round-trip through a JSON array string, so the app can keep them in `@AppStorage`.
    static func decodeCollapsed(_ stored: String) -> Set<String> {
        guard let data = stored.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return Set(ids)
    }

    static func encodeCollapsed(_ ids: Set<String>) -> String {
        let data = (try? JSONEncoder().encode(ids.sorted())) ?? Data("[]".utf8)
        return String(bytes: data, encoding: .utf8) ?? "[]"
    }

    static func toggled(_ localId: String, in collapsed: Set<String>) -> Set<String> {
        var next = collapsed
        if !next.insert(localId).inserted { next.remove(localId) }
        return next
    }
}
