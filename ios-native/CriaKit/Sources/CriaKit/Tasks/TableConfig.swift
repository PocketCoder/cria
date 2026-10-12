import Foundation

/// Table view columns, in Vikunja's fixed render order. Ported from `useTableConfig.ts`. Comments and
/// created-by have no local data, so those columns are omitted.
public enum TableViewColumn: String, CaseIterable, Sendable {
    case index, done, project, title, priority, labels, assignees
    case dueDate, startDate, endDate, percentDone, updated, created, doneAt

    public var label: String {
        switch self {
        case .index: return "#"
        case .done: return "Done"
        case .project: return "Project"
        case .title: return "Title"
        case .priority: return "Priority"
        case .labels: return "Labels"
        case .assignees: return "Assignees"
        case .dueDate: return "Due Date"
        case .startDate: return "Start Date"
        case .endDate: return "End Date"
        case .percentDone: return "% Done"
        case .updated: return "Updated"
        case .created: return "Created"
        case .doneAt: return "Done At"
        }
    }

    /// Labels and assignees have no single sortable value.
    public var sortable: Bool { self != .labels && self != .assignees }

    /// Vikunja's default visible set, minus assignees: they are not loaded into table rows yet, so the column would be empty.
    public static let defaultVisible: Set<TableViewColumn> = [.index, .done, .title, .labels, .dueDate]
}

/// One active sort key. Order in the array is priority order.
public struct TableSortKey: Equatable, Sendable {
    public let column: TableViewColumn
    public let direction: SortDirection

    public init(column: TableViewColumn, direction: SortDirection) {
        self.column = column
        self.direction = direction
    }
}

public enum TableSort {
    /// Vikunja's default sort.
    public static let defaultKeys = [TableSortKey(column: .index, direction: .desc)]

    /// The direction a column starts in when picked from the Sort menu: dates and text ascending (soonest, A to Z),
    /// numbers descending (newest id, highest priority, most done, latest change).
    public static func defaultDirection(for column: TableViewColumn) -> SortDirection {
        switch column {
        case .dueDate, .startDate, .endDate, .title, .project, .done: return .asc
        case .index, .priority, .percentDone, .updated, .created, .doneAt, .labels, .assignees: return .desc
        }
    }

    /// Advances a column one step: none, then descending, then ascending, then none. `additive` keeps the other
    /// keys and their priority; otherwise the column becomes the only key.
    public static func cycle(_ keys: [TableSortKey], column: TableViewColumn, additive: Bool) -> [TableSortKey] {
        let current = keys.first { $0.column == column }?.direction
        let next: SortDirection?
        switch current {
        case nil: next = .desc
        case .desc?: next = .asc
        case .asc?: next = nil
        }
        guard additive else { return next.map { [TableSortKey(column: column, direction: $0)] } ?? [] }
        var result: [TableSortKey] = []
        for key in keys {
            if key.column != column {
                result.append(key)
            } else if let next {
                result.append(TableSortKey(column: column, direction: next))
            }
        }
        if current == nil, let next { result.append(TableSortKey(column: column, direction: next)) }
        return result
    }

    /// Stable multi-column sort over sortable, visible columns. Nil values sort last in either direction.
    public static func sorted(
        _ tasks: [TaskRecord], keys: [TableSortKey], visible: Set<TableViewColumn>, projectTitle: (String) -> String = { _ in "" }
    ) -> [TaskRecord] {
        let active = keys.filter { $0.column.sortable && visible.contains($0.column) }
        guard !active.isEmpty else { return tasks }
        let keyed = tasks.enumerated().map { (index: $0.offset, task: $0.element) }
        let ordered = keyed.sorted { left, right in
            for key in active {
                let result = SortValue.compare(
                    value(left.task, key.column, projectTitle), value(right.task, key.column, projectTitle),
                    direction: key.direction
                )
                if result != 0 { return result < 0 }
            }
            return left.index < right.index
        }
        return ordered.map(\.task)
    }

    private static func value(_ task: TaskRecord, _ column: TableViewColumn, _ projectTitle: (String) -> String) -> SortValue? {
        switch column {
        case .index: return task.serverId.map { .number(Double($0)) }
        case .done: return .number(task.done ? 1 : 0)
        case .project: return .text(projectTitle(task.projectLocalId).lowercased())
        case .title: return .text(task.title.lowercased())
        case .priority: return .number(Double(task.priority))
        case .percentDone: return .number(task.percentDone)
        case .dueDate: return SortValue.date(task.dueDate)
        case .startDate: return SortValue.date(task.startDate)
        case .endDate: return SortValue.date(task.endDate)
        case .doneAt: return SortValue.date(task.doneAt)
        case .updated: return SortValue.date(task.updatedAt)
        case .created: return SortValue.date(task.createdAt)
        case .labels, .assignees: return nil
        }
    }
}

/// Text forms of the table config, for `UserDefaults`. Unknown names are dropped so an old value never breaks a launch.
public enum TableConfigCodec {
    public static func encodeColumns(_ columns: Set<TableViewColumn>) -> String {
        TableViewColumn.allCases.filter { columns.contains($0) }.map(\.rawValue).joined(separator: ",")
    }

    public static func decodeColumns(_ text: String) -> Set<TableViewColumn> {
        guard !text.isEmpty else { return TableViewColumn.defaultVisible }
        return Set(text.split(separator: ",").compactMap { TableViewColumn(rawValue: String($0)) })
    }

    public static func encodeSort(_ keys: [TableSortKey]) -> String {
        if keys.isEmpty { return "none" }
        return keys.map { "\($0.column.rawValue):\($0.direction.rawValue)" }.joined(separator: ",")
    }

    /// An empty string means the default sort; "none" means the user cleared it.
    public static func decodeSort(_ text: String) -> [TableSortKey] {
        if text.isEmpty { return TableSort.defaultKeys }
        if text == "none" { return [] }
        return text.split(separator: ",").compactMap { part in
            let pieces = part.split(separator: ":")
            guard pieces.count == 2, let column = TableViewColumn(rawValue: String(pieces[0])),
                  let direction = SortDirection(rawValue: String(pieces[1])) else { return nil }
            return TableSortKey(column: column, direction: direction)
        }
    }
}

/// Cell text for the table view, shared by the wide grid and the compact iPhone rows.
public enum TableCells {
    /// Vikunja's priority names, indexed by priority.
    public static let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]

    /// The name for a priority, or nil for none (0) and out-of-range values.
    public static func priorityName(_ priority: Int) -> String? {
        guard priority > 0, priority < priorityNames.count else { return nil }
        return priorityNames[priority]
    }

    /// Short text for one cell, or nil when the cell is empty. Title, done and labels are drawn as their own
    /// controls, so they have no text here; assignees are not loaded into table rows.
    public static func text(
        _ task: TaskRecord, _ column: TableViewColumn, projectTitle: String?, now: Date, display: DateDisplay = .standard
    ) -> String? {
        func date(_ iso: String?) -> String? {
            guard let iso else { return nil }
            let label = DueDates.label(iso, now: now, display: display)
            return label.isEmpty ? nil : label
        }
        switch column {
        case .index: return task.serverId.map { "#\($0)" }
        case .project: return projectTitle.flatMap { $0.isEmpty ? nil : $0 }
        case .priority: return priorityName(task.priority)
        case .percentDone: return task.percentDone > 0 ? "\(Int((task.percentDone * 100).rounded()))%" : nil
        case .dueDate: return date(task.dueDate)
        case .startDate: return date(task.startDate)
        case .endDate: return date(task.endDate)
        case .updated: return date(task.updatedAt)
        case .created: return date(task.createdAt)
        case .doneAt: return task.done ? date(task.doneAt) : nil
        case .title, .done, .labels, .assignees: return nil
        }
    }

    /// The text for the sort in force, such as "Due Date, earliest first", or nil for no sort.
    public static func sortSummary(_ keys: [TableSortKey]) -> String? {
        guard let key = keys.first else { return nil }
        let order: String
        switch key.column {
        case .dueDate, .startDate, .endDate, .updated, .created, .doneAt:
            order = key.direction == .asc ? "earliest first" : "latest first"
        case .title, .project:
            order = key.direction == .asc ? "A to Z" : "Z to A"
        default:
            order = key.direction == .asc ? "lowest first" : "highest first"
        }
        return "\(key.column.label), \(order)"
    }
}
