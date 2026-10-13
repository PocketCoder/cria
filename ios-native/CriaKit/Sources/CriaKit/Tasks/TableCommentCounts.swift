import Foundation
import GRDB

/// Comment counts for the table view's Comments column, keyed by task server id. The schema (shared with the desktop)
/// has no count column and the pull reads comments only for opened tasks, so the counts come from the server while
/// the column is shown and live only in memory.
public struct TableCommentCounts: Equatable, Sendable {
    /// Comment count by task server id. Tasks with no entry are unknown.
    public var counts: [Int: Int]
    /// True when the server answered; false for the local fallback.
    public var fromServer: Bool

    public init(counts: [Int: Int] = [:], fromServer: Bool = false) {
        self.counts = counts
        self.fromServer = fromServer
    }

    /// Reads the counts through the project's view (`GET /projects/{id}/views/{view}/tasks?expand=comment_count`,
    /// every page). Offline, for a project or view not yet synced, or when the server rejects the expand (Vikunja
    /// before `comment_count` answers 400), it falls back to the synced comment rows on this device. Tasks the
    /// server did not return (outside the view's filter) also keep their local count.
    public static func load(api: ApiClient, store: CriaStore, projectLocalId: String, viewLocalId: String?) async -> TableCommentCounts {
        let local = (try? store.localCommentCounts(projectLocalId: projectLocalId)) ?? [:]
        guard let route = try? store.commentCountRoute(projectLocalId: projectLocalId, viewLocalId: viewLocalId),
              let base = await api.serverBase(), !ExpandSupport.shared.isUnsupported(base) else {
            return TableCommentCounts(counts: local)
        }
        let raws: [Data]
        do {
            raws = try await api.fetchAllPages(
                "/projects/\(route.project)/views/\(route.view)/tasks", query: ["expand": "comment_count"]
            )
        } catch let error as ApiError where error.status == 400 {
            ExpandSupport.shared.markUnsupported(base)
            return TableCommentCounts(counts: local)
        } catch {
            return TableCommentCounts(counts: local)
        }
        var counts = local
        for raw in raws {
            guard let item = try? JSONDecoder().decode(CountedTask.self, from: raw) else { continue }
            // A server that ignores the expand sends no count: keep what is known locally rather than claim zero.
            if let count = item.commentCount { counts[item.id] = count }
        }
        return TableCommentCounts(counts: counts, fromServer: true)
    }
}

/// The part of a task the count read needs.
private struct CountedTask: Decodable {
    let id: Int
    let commentCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case commentCount = "comment_count"
    }
}

/// Servers that rejected `expand=comment_count` this session, so the table does not ask them again.
final class ExpandSupport: @unchecked Sendable {
    static let shared = ExpandSupport()
    private let lock = NSLock()
    private var unsupported: Set<String> = []

    func isUnsupported(_ base: String) -> Bool { lock.withLock { unsupported.contains(base) } }
    func markUnsupported(_ base: String) { lock.withLock { _ = unsupported.insert(base) } }
    func reset() { lock.withLock { unsupported = [] } }
}

extension CriaStore {
    /// Synced, live comment rows per task server id in a project. Only tasks with at least one row appear: the pull
    /// does not read comments, so no rows means unknown, not zero.
    public func localCommentCounts(projectLocalId: String) throws -> [Int: Int] {
        try database.writer.read { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT t.server_id AS task_id, COUNT(*) AS total FROM task_comments c
                  JOIN tasks t ON t.local_id = c.task_local_id
                 WHERE t.project_local_id = ? AND t.server_id IS NOT NULL
                   AND c.deleted = 0 AND c.server_id > 0
                 GROUP BY t.server_id
                """, arguments: [projectLocalId])
            let pairs = rows.map { (row: Row) -> (Int, Int) in (row["task_id"], row["total"]) }
            return Dictionary(pairs, uniquingKeysWith: { first, _ in first })
        }
    }

    /// The project and view server ids to read the project's tasks through: the given view, else its first synced
    /// table, list or Gantt view. Kanban views answer with buckets, so they are skipped.
    func commentCountRoute(projectLocalId: String, viewLocalId: String?) throws -> (project: Int, view: Int)? {
        guard let project = try projectServerId(localId: projectLocalId), project > 0 else { return nil }
        let views = try views(forProject: projectLocalId).filter { $0.serverId != nil && $0.viewKind != .kanban }
        let preferred = views.first { $0.localId == viewLocalId }
            ?? views.first { $0.viewKind == .table }
            ?? views.first { $0.viewKind == .list }
            ?? views.first
        guard let view = preferred?.serverId else { return nil }
        return (project, view)
    }
}

public extension AppServices {
    /// Comment counts for the table view. See `TableCommentCounts.load`.
    func tableCommentCounts(projectLocalId: String, viewLocalId: String?) async -> TableCommentCounts {
        await TableCommentCounts.load(api: api, store: store, projectLocalId: projectLocalId, viewLocalId: viewLocalId)
    }
}
