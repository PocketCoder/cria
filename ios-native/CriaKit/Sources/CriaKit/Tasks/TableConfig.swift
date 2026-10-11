import Foundation

/// Table view columns, in Vikunja's fixed render order. Ported from `useTableConfig.ts`. Comments and
/// created-by have no local data, so those columns are omitted.
public enum TableColumn: String, CaseIterable, Sendable {
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

    /// Vikunja's default visible set.
    public static let defaultVisible: Set<TableColumn> = [.index, .done, .title, .labels, .assignees, .dueDate]
}

/// One active sort key. Order in the array is priority order.
public struct TableSortKey: Equatable, Sendable {
    public let column: TableColumn
    public let direction: SortDirection

    public init(column: TableColumn, direction: SortDirection) {
        self.column = column
        self.direction = direction
    }
}

public enum TableSort {
    /// Vikunja's default sort.
    public static let defaultKeys = [TableSortKey(column: .index, direction: .desc)]

    /// Advances a column one step: none, then descending, then ascending, then none. `additive` keeps the other
    /// keys and their priority; otherwise the column becomes the only key.
    public static func cycle(_ keys: [TableSortKey], column: TableColumn, additive: Bool) -> [TableSortKey] {
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
        _ tasks: [TaskRecord], keys: [TableSortKey], visible: Set<TableColumn>, projectTitle: (String) -> String = { _ in "" }
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

    private static func value(_ task: TaskRecord, _ column: TableColumn, _ projectTitle: (String) -> String) -> SortValue? {
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
    public static func encodeColumns(_ columns: Set<TableColumn>) -> String {
        TableColumn.allCases.filter { columns.contains($0) }.map(\.rawValue).joined(separator: ",")
    }

    public static func decodeColumns(_ text: String) -> Set<TableColumn> {
        guard !text.isEmpty else { return TableColumn.defaultVisible }
        return Set(text.split(separator: ",").compactMap { TableColumn(rawValue: String($0)) })
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
            guard pieces.count == 2, let column = TableColumn(rawValue: String(pieces[0])),
                  let direction = SortDirection(rawValue: String(pieces[1])) else { return nil }
            return TableSortKey(column: column, direction: direction)
        }
    }
}
