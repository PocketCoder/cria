import Foundation
import GRDB

private let searchLetterAndNumberCategories: Set<Unicode.GeneralCategory> = [
    .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
    .decimalNumber, .letterNumber, .otherNumber
]

private let ftsReservedWords: Set<String> = ["AND", "OR", "NOT", "NEAR"]

extension CriaStore {
    /// Strips everything except letters, digits and whitespace (`[^\p{L}\p{N}\s]` in the TypeScript).
    static func sanitizedSearchText(_ text: String) -> String {
        let kept = text.unicodeScalars.filter {
            searchLetterAndNumberCategories.contains($0.properties.generalCategory) || $0.properties.isWhitespace
        }
        return String(String.UnicodeScalarView(kept)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// FTS5 MATCH expression: each word becomes a prefix term, joined with AND. Reserved words are quoted.
    /// Returns nil when no text remains, so the caller skips MATCH.
    static func ftsMatchExpression(for text: String) -> String? {
        let words = sanitizedSearchText(text).split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return nil }
        return words
            .map { ftsReservedWords.contains($0.uppercased()) ? "\"\($0)\"" : "\($0)*" }
            .joined(separator: " AND ")
    }

    private static func appendStructuredFilters(
        _ query: SearchQuery, conditions: inout [String], arguments: inout [(any DatabaseValueConvertible)?]
    ) {
        if let start = query.dueDateStart, !start.isEmpty {
            conditions.append("t.due_date >= ?")
            arguments.append(start)
        }
        if let end = query.dueDateEnd, !end.isEmpty {
            conditions.append("t.due_date <= ?")
            arguments.append(end)
        }
        if let priority = query.priority {
            conditions.append("t.priority = ?")
            arguments.append(priority)
        }
        if let label = query.labelTitle, !label.isEmpty {
            conditions.append("""
                t.local_id IN (
                  SELECT tl.task_local_id FROM task_labels tl
                  JOIN labels l ON l.local_id = tl.label_local_id
                  WHERE l.title = ? AND tl.deleted = 0
                )
                """)
            arguments.append(label)
        }
    }

    /// Offline full-text search over non-deleted tasks (title and description, porter stemmed prefix match)
    /// with optional due-date range, priority and label filters. Without text the FTS index is skipped and
    /// results sort by due date then priority. At most 50 rows, like `searchTasks` in `src/db/tasks.ts`.
    public func searchTasks(_ query: SearchQuery) throws -> [TaskRecord] {
        let match = CriaStore.ftsMatchExpression(for: query.text)
        var conditions = ["t.deleted = 0", "p.deleted = 0"]
        var arguments: [(any DatabaseValueConvertible)?] = []

        if let match {
            conditions.append("tasks_fts MATCH ?")
            arguments.append(match)
        }
        CriaStore.appendStructuredFilters(query, conditions: &conditions, arguments: &arguments)

        let columns = CriaStore.taskColumns.split(separator: ",").map { "t." + $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let source = match == nil
            ? "tasks t JOIN projects p ON p.local_id = t.project_local_id"
            : "tasks_fts JOIN tasks t ON t.rowid = tasks_fts.rowid JOIN projects p ON p.local_id = t.project_local_id"
        let order = match == nil ? "t.due_date ASC, t.priority DESC" : "rank"
        let sql = """
            SELECT \(columns.joined(separator: ", ")) FROM \(source)
             WHERE \(conditions.joined(separator: " AND "))
             ORDER BY \(order)
             LIMIT 50
            """
        return try database.writer.read { connection in
            try Row.fetchAll(connection, sql: sql, arguments: StatementArguments(arguments)).map(TaskRecord.init(row:))
        }
    }
}
