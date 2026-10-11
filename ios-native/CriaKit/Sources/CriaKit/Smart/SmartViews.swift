import Foundation
import GRDB

public enum SmartView: Hashable, Sendable {
    case today
    case upcoming
    /// Tasks in the user's default project. Nil until the default project id is known.
    case inbox(defaultProjectServerId: Int?)
    case savedFilter(serverId: Int)
}

/// A titled section of a smart view.
public struct TaskGroup: Equatable, Sendable {
    public let key: String
    public let label: String
    public let items: [TaskListItem]
}

public enum SmartViewGrouping {
    /// Overdue (only when there are any, shown first) then due today. Ported from `groupToday`.
    public static func today(_ items: [TaskListItem], now: Date, calendar: Calendar = .cria) -> [TaskGroup] {
        let start = calendar.startOfDay(for: now)
        var overdue: [TaskListItem] = []
        var due: [TaskListItem] = []
        for item in items {
            guard let iso = item.task.dueDate, let day = DueDates.calendarDate(iso, calendar: calendar) else { continue }
            if day < start { overdue.append(item) } else if day == start { due.append(item) }
        }
        var groups: [TaskGroup] = []
        if !overdue.isEmpty { groups.append(TaskGroup(key: "overdue", label: "Overdue", items: overdue)) }
        groups.append(TaskGroup(key: "today", label: "Today", items: due))
        return groups
    }

    /// Tasks due today or later, one section per day in date order. Ported from `upcomingFrom` plus the sectioning.
    public static func upcoming(_ items: [TaskListItem], now: Date, calendar: Calendar = .cria) -> [TaskGroup] {
        let start = calendar.startOfDay(for: now)
        var order: [String] = []
        var byDay: [String: [TaskListItem]] = [:]
        var labels: [String: String] = [:]
        for item in items {
            guard let iso = item.task.dueDate, let day = DueDates.calendarDate(iso, calendar: calendar), day >= start,
                  let key = DueDates.dayKey(iso, calendar: calendar) else { continue }
            if byDay[key] == nil {
                order.append(key)
                labels[key] = DueDates.label(DueDates.allDayISO(for: day, calendar: calendar), now: now, calendar: calendar)
            }
            byDay[key, default: []].append(item)
        }
        return order.sorted().map { TaskGroup(key: $0, label: labels[$0] ?? $0, items: byDay[$0] ?? []) }
    }
}

/// Whether any clause in a filter names the `done` field. A filter that does not gets open tasks only,
/// matching `hasDoneFilter` in the TypeScript.
func filterMentionsDone(_ node: FilterNode?) -> Bool {
    switch node {
    case .none: return false
    case .clause(let clause): return clause.field == "done"
    case .group(let group): return group.children.contains { filterMentionsDone($0) }
    }
}

extension CriaStore {
    public func smartGroups(_ view: SmartView, now: Date = Date(), calendar: Calendar = .cria) throws -> [TaskGroup] {
        switch view {
        case .today: return SmartViewGrouping.today(try datedOpenTasks(), now: now, calendar: calendar)
        case .upcoming: return SmartViewGrouping.upcoming(try datedOpenTasks(), now: now, calendar: calendar)
        case .inbox(let serverId): return try inboxGroups(defaultProjectServerId: serverId)
        case .savedFilter(let serverId): return try savedFilterGroups(serverId: serverId, now: now, calendar: calendar)
        }
    }

    /// Open, non-deleted tasks with a due date across live projects, soonest first. Capped at 5000 so a very long
    /// overdue list cannot push today out.
    func datedOpenTasks() throws -> [TaskListItem] {
        let tasks = try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.qualifiedTaskColumns) FROM tasks t
                  JOIN projects p ON p.local_id = t.project_local_id
                 WHERE t.deleted = 0 AND t.done = 0 AND t.due_date IS NOT NULL AND p.deleted = 0
                 ORDER BY t.due_date ASC, t.priority DESC
                 LIMIT 5000
                """).map(TaskRecord.init(row:))
        }
        return try attachRowData(tasks)
    }

    func inboxGroups(defaultProjectServerId: Int?) throws -> [TaskGroup] {
        guard let serverId = defaultProjectServerId else { return [] }
        let localId = try database.writer.read { connection in
            try String.fetchOne(
                connection, sql: "SELECT local_id FROM projects WHERE server_id = ? AND deleted = 0", arguments: [serverId]
            )
        }
        guard let localId else { return [] }
        return [TaskGroup(key: "inbox", label: "Inbox", items: try taskItems(.project(localId)))]
    }

    /// A saved filter is the task source. A filter row missing locally shows nothing, not every task.
    func savedFilterGroups(serverId: Int, now: Date, calendar: Calendar) throws -> [TaskGroup] {
        guard let saved = try savedFilter(serverId: serverId) else { return [] }
        let parsed = try parseFilterQuery(saved.filterQuery, now: now, calendar: calendar)
        let compiled = try compileFilter(parsed.ast, includeNulls: saved.filterIncludeNulls)
        var conditions = ["t.deleted = 0", "p.deleted = 0"]
        if !filterMentionsDone(parsed.ast) { conditions.append("t.done = 0") }
        if !compiled.whereClause.isEmpty { conditions.append("(\(compiled.whereClause))") }
        let order = CriaStore.taskOrder.split(separator: ",").map { "t." + $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let tasks = try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT \(CriaStore.qualifiedTaskColumns) FROM tasks t
                  JOIN projects p ON p.local_id = t.project_local_id
                 WHERE \(conditions.joined(separator: " AND "))
                 ORDER BY \(order.joined(separator: ", "))
                """, arguments: compiled.arguments).map(TaskRecord.init(row:))
        }
        return [TaskGroup(key: "filter", label: saved.title, items: try attachRowData(tasks))]
    }
}
