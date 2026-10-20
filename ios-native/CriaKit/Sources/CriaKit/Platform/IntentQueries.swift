import Foundation
import GRDB

/// A task or project as an App Intent entity sees it: an id and a title, nothing else.
public struct IntentEntry: Equatable, Sendable {
    public let localId: String
    public let title: String

    public init(localId: String, title: String) {
        self.localId = localId
        self.title = title
    }
}

public extension CriaStore {
    /// Open tasks whose title contains `text` (all open tasks, soonest due first, when blank). For the task entity's
    /// suggestions and search in Shortcuts and Siri.
    func openTaskEntries(matching text: String, limit: Int = 25) throws -> [IntentEntry] {
        let needle = Self.likePattern(text)
        return try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT t.local_id, t.title FROM tasks t
                  JOIN projects p ON p.local_id = t.project_local_id
                 WHERE t.deleted = 0 AND t.done = 0 AND p.deleted = 0 AND t.title LIKE ? ESCAPE '\\'
                 ORDER BY t.due_date IS NULL, t.due_date ASC, t.title COLLATE NOCASE ASC LIMIT ?
                """, arguments: [needle, limit]).map { IntentEntry(localId: $0["local_id"], title: $0["title"]) }
        }
    }

    /// Tasks by local id, in any state, for resolving a saved entity. Missing or deleted ones are left out.
    func taskEntries(localIds: [String]) throws -> [IntentEntry] {
        try localIds.compactMap { id in try task(localId: id).map { IntentEntry(localId: $0.localId, title: $0.title) } }
    }

    /// Projects a task can live in (no archived ones), whose title contains `text`.
    func projectEntries(matching text: String, limit: Int = 50) throws -> [IntentEntry] {
        let needle = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return try ProjectTree.visible(try projects())
            .filter { needle.isEmpty || $0.title.lowercased().contains(needle) }
            .prefix(limit)
            .map { IntentEntry(localId: $0.localId, title: $0.title) }
    }

    func projectEntries(localIds: [String]) throws -> [IntentEntry] {
        let wanted = Set(localIds)
        return try projects().filter { wanted.contains($0.localId) }.map { IntentEntry(localId: $0.localId, title: $0.title) }
    }

    private static func likePattern(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let escaped = trimmed
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
        return "%\(escaped)%"
    }
}
