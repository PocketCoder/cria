import Foundation
import GRDB

/// What a task list shows. Smart views join in S-47.
public enum TaskListSource: Hashable, Sendable {
    case project(String)
    case favorites
    case label(String)
}

/// One list row: the task plus what the row renders beside it.
public struct TaskListItem: Equatable, Sendable {
    public let task: TaskRecord
    public let labels: [LabelRecord]
    public let projectTitle: String?
}

extension CriaStore {
    /// `taskColumns` prefixed with the `t` alias, for queries that join other tables.
    static var qualifiedTaskColumns: String {
        taskColumns.split(separator: ",").map { "t." + $0.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: ", ")
    }

    /// Tasks for a list, in the app's local order (done last), with labels and project titles attached.
    public func taskItems(_ source: TaskListSource, includeDone: Bool = true) throws -> [TaskListItem] {
        let tasks: [TaskRecord]
        switch source {
        case .project(let localId):
            tasks = try self.tasks(matching: TaskQuery(projectLocalId: localId, includeDone: includeDone))
        case .favorites:
            tasks = try self.tasks(matching: TaskQuery(includeDone: includeDone, favoritesOnly: true))
        case .label(let labelLocalId):
            tasks = try self.tasks(withLabel: labelLocalId, includeDone: includeDone)
        }
        return try attachRowData(tasks)
    }

    func tasks(withLabel labelLocalId: String, includeDone: Bool) throws -> [TaskRecord] {
        let doneClause = includeDone ? "" : "AND t.done = 0"
        return try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.qualifiedTaskColumns) FROM tasks t
                  JOIN task_labels tl ON tl.task_local_id = t.local_id
                 WHERE tl.label_local_id = ? AND tl.deleted = 0 AND t.deleted = 0 \(doneClause)
                 ORDER BY \(CriaStore.taskOrder)
                """, arguments: [labelLocalId]).map(TaskRecord.init(row:))
        }
    }

    /// Adds labels and project titles to a task list with two queries, not one per row.
    public func attachRowData(_ tasks: [TaskRecord]) throws -> [TaskListItem] {
        let labelsByTask = try labelsGroupedByTask()
        let titles = try projectTitles()
        return tasks.map { task in
            TaskListItem(task: task, labels: labelsByTask[task.localId] ?? [], projectTitle: titles[task.projectLocalId])
        }
    }

    func labelsGroupedByTask() throws -> [String: [LabelRecord]] {
        try database.writer.read { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT tl.task_local_id AS owner, l.local_id, l.server_id, l.title, l.description, l.hex_color, l.updated_at
                  FROM task_labels tl JOIN labels l ON l.local_id = tl.label_local_id
                 WHERE tl.deleted = 0 AND l.deleted = 0
                 ORDER BY l.title COLLATE NOCASE ASC
                """)
            var grouped: [String: [LabelRecord]] = [:]
            for row in rows {
                let owner: String = row["owner"]
                grouped[owner, default: []].append(LabelRecord(row: row))
            }
            return grouped
        }
    }

    func projectTitles() throws -> [String: String] {
        try database.writer.read { connection in
            var titles: [String: String] = [:]
            for row in try Row.fetchAll(connection, sql: "SELECT local_id, title FROM projects WHERE deleted = 0") {
                let localId: String = row["local_id"]
                titles[localId] = row["title"]
            }
            return titles
        }
    }
}
