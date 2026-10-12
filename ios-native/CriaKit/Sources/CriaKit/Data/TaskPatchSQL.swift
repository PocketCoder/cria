import Foundation
import GRDB

extension TaskPatch {
    /// The SET clauses and arguments for the fields this patch changes, after the always-set dirty and updated_at.
    func assignments(now: String) -> ([String], [(any DatabaseValueConvertible)?]) {
        var columns = ["dirty = 1", "updated_at = ?"]
        var arguments: [(any DatabaseValueConvertible)?] = [now]
        func add(_ column: String, _ value: (any DatabaseValueConvertible)?) {
            columns.append("\(column) = ?")
            arguments.append(value)
        }
        if let title { add("title", title) }
        if let done {
            add("done", done)
            add("done_at", done ? now : nil)
        }
        for (column, value) in [("due_date", dueDate), ("start_date", startDate), ("end_date", endDate)] {
            guard let value else { continue }
            add(column, value.isEmpty ? nil : value)
        }
        let optionalFields: [(String, (any DatabaseValueConvertible)?)] = [
            ("description", description), ("project_local_id", projectLocalId),
            ("priority", priority), ("is_favorite", isFavorite), ("percent_done", percentDone),
            ("repeat_after", repeatAfter), ("repeat_mode", repeatMode)
        ]
        for (column, value) in optionalFields where value != nil {
            add(column, value)
        }
        return (columns, arguments)
    }
}
