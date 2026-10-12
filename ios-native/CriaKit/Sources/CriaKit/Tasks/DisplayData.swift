import Foundation
import GRDB

extension CriaStore {
    /// Task local id to the user ids assigned to it, for the assignee filter. One query for every task.
    public func assigneeMap() throws -> [String: Set<Int>] {
        try database.writer.read { connection in
            var map: [String: Set<Int>] = [:]
            for row in try Row.fetchAll(connection, sql: """
                SELECT task_local_id, user_server_id FROM task_assignees WHERE deleted = 0
                """) {
                let task: String = row["task_local_id"]
                let user: Int = row["user_server_id"]
                map[task, default: []].insert(user)
            }
            return map
        }
    }

    /// Like `smartGroups`, but with the completed tasks too when `includeDone`, so the Display sheet's Show completed
    /// can reveal them. Today adds tasks that were due today and are done (a finished overdue task is not "today's");
    /// Upcoming adds finished tasks due today or later. Inbox and saved filters already return what they match.
    public func smartGroups(
        _ view: SmartView, includeDone: Bool, now: Date = Date(), calendar: Calendar = .cria
    ) throws -> [TaskGroup] {
        guard includeDone else { return try smartGroups(view, now: now, calendar: calendar) }
        let start = calendar.startOfDay(for: now)
        switch view {
        case .today:
            let items = try datedTasks(includeDone: true).filter { item in
                guard item.task.done else { return true }
                return item.task.dueDate.flatMap { DueDates.calendarDate($0, calendar: calendar) } == start
            }
            return SmartViewGrouping.today(items, now: now, calendar: calendar)
        case .upcoming:
            return SmartViewGrouping.upcoming(try datedTasks(includeDone: true), now: now, calendar: calendar)
        default:
            return try smartGroups(view, now: now, calendar: calendar)
        }
    }

    /// Non-deleted tasks with a due date across live projects, soonest first; open only unless `includeDone`.
    func datedTasks(includeDone: Bool) throws -> [TaskListItem] {
        let doneClause = includeDone ? "" : "AND t.done = 0"
        let tasks = try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.qualifiedTaskColumns) FROM tasks t
                  JOIN projects p ON p.local_id = t.project_local_id
                 WHERE t.deleted = 0 AND t.due_date IS NOT NULL AND p.deleted = 0 \(doneClause)
                 ORDER BY t.due_date ASC, t.priority DESC
                """).map(TaskRecord.init(row:))
        }
        return try attachRowData(tasks)
    }

    /// Open tasks with no due date, the best first (highest priority, then oldest), capped.
    func undatedOpenTasks(limit: Int) throws -> [TaskListItem] {
        let tasks = try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.qualifiedTaskColumns) FROM tasks t
                  JOIN projects p ON p.local_id = t.project_local_id
                 WHERE t.deleted = 0 AND t.done = 0 AND t.due_date IS NULL AND p.deleted = 0
                 ORDER BY t.priority DESC, t.created_at ASC
                 LIMIT ?
                """, arguments: [limit]).map(TaskRecord.init(row:))
        }
        return try attachRowData(tasks)
    }
}
