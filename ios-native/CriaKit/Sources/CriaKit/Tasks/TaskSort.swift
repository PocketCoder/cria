import Foundation

public enum SortField: String, CaseIterable, Sendable {
    case userDefinedOrder = "user_defined_order"
    case percentDone, created, dueDate, endDate, priority, startDate, title, updated
}

public enum SortDirection: String, Sendable {
    case asc, desc
}

public struct SortRule: Equatable, Sendable {
    public let field: SortField
    public let direction: SortDirection

    public init(field: SortField, direction: SortDirection) {
        self.field = field
        self.direction = direction
    }
}

public struct SortOption: Equatable, Sendable {
    public let label: String
    public let rule: SortRule
}

/// A comparable cell value. Nil (no value) always sorts last, in either direction.
enum SortValue: Equatable {
    case number(Double)
    case text(String)

    /// Three-way compare. Mixed kinds do not occur within one column.
    func compare(to other: SortValue) -> Int {
        switch (self, other) {
        case let (.number(left), .number(right)): return left < right ? -1 : (left > right ? 1 : 0)
        case let (.text(left), .text(right)): return left < right ? -1 : (left > right ? 1 : 0)
        default: return 0
        }
    }

    static func compare(_ left: SortValue?, _ right: SortValue?, direction: SortDirection) -> Int {
        switch (left, right) {
        case (nil, nil): return 0
        case (nil, _?): return 1
        case (_?, nil): return -1
        case let (leftValue?, rightValue?):
            let result = leftValue.compare(to: rightValue)
            return direction == .asc ? result : -result
        }
    }

    static func date(_ iso: String?) -> SortValue? {
        guard let iso, let parsed = DueDates.parse(iso) else { return nil }
        return .number(parsed.timeIntervalSince1970)
    }
}

/// Ported from `src/lib/sortEngine.ts`. The desktop builds an SQL ORDER BY; here a comparator gives the same order.
public enum TaskSort {
    public static let options: [SortOption] = [
        option("Manually", .userDefinedOrder, .asc),
        option("% done (Least done first)", .percentDone, .asc),
        option("% done (Most done first)", .percentDone, .desc),
        option("Created (Newest first)", .created, .desc),
        option("Created (Oldest first)", .created, .asc),
        option("Due date (Earliest first)", .dueDate, .asc),
        option("Due date (Latest first)", .dueDate, .desc),
        option("End date (Earliest first)", .endDate, .asc),
        option("End date (Latest first)", .endDate, .desc),
        option("Priority (Highest first)", .priority, .desc),
        option("Priority (Lowest first)", .priority, .asc),
        option("Start date (Earliest first)", .startDate, .asc),
        option("Start date (Latest first)", .startDate, .desc),
        option("Title (A\u{2013}Z)", .title, .asc),
        option("Title (Z\u{2013}A)", .title, .desc),
        option("Updated (Newest first)", .updated, .desc),
        option("Updated (Oldest first)", .updated, .asc)
    ]

    private static func option(_ label: String, _ field: SortField, _ direction: SortDirection) -> SortOption {
        SortOption(label: label, rule: SortRule(field: field, direction: direction))
    }

    /// Tasks ordered by the rule. A nil rule keeps the input order. Stable.
    public static func sorted(_ tasks: [TaskRecord], by rule: SortRule?) -> [TaskRecord] {
        guard let rule else { return tasks }
        let keyed = tasks.enumerated().map { (index: $0.offset, task: $0.element) }
        let ordered = keyed.sorted { left, right in
            let result = SortValue.compare(
                value(left.task, rule.field, rule.direction), value(right.task, rule.field, rule.direction),
                direction: rule.direction
            )
            return result == 0 ? left.index < right.index : result < 0
        }
        return ordered.map(\.task)
    }

    private static func value(_ task: TaskRecord, _ field: SortField, _ direction: SortDirection) -> SortValue? {
        switch field {
        case .userDefinedOrder: return .number(task.position ?? 999_999)
        case .percentDone: return .number(task.percentDone)
        case .priority: return .number(Double(task.priority))
        case .created: return SortValue.date(task.createdAt)
        case .updated: return SortValue.date(task.updatedAt)
        case .dueDate: return SortValue.date(task.dueDate)
        case .startDate: return SortValue.date(task.startDate)
        case .endDate: return SortValue.date(task.endDate)
        // SQL sorts ascending titles with NOCASE and descending ones by raw bytes.
        case .title: return .text(direction == .asc ? task.title.lowercased() : task.title)
        }
    }
}
