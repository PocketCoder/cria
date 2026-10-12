import Foundation

/// A titled run of tasks: a group in a grouped list, or a day in Upcoming. An empty label draws no header.
public struct DisplaySection: Equatable, Sendable, Identifiable {
    public let key: String
    public let label: String
    public var items: [TaskListItem]
    public var id: String { key }

    public init(key: String, label: String, items: [TaskListItem]) {
        self.key = key
        self.label = label
        self.items = items
    }
}

/// What filtering and grouping need besides the tasks. The caller owns the clock, so tests can pin it.
public struct DisplayContext: Sendable {
    /// Task local id to the user ids assigned to it (`CriaStore.assigneeMap`).
    public var assigneesByTask: [String: Set<Int>]
    public var currentUserId: Int?
    public var now: Date
    public var calendar: Calendar

    public init(
        assigneesByTask: [String: Set<Int>] = [:], currentUserId: Int? = nil, now: Date = Date(), calendar: Calendar = .cria
    ) {
        self.assigneesByTask = assigneesByTask
        self.currentUserId = currentUserId
        self.now = now
        self.calendar = calendar
    }
}

/// Filter, sort and group over a task list, driven by a `DisplayConfig`. Ported from `applyDisplay` in
/// `src/lib/displayConfig.ts`, so every list screen shares one engine.
public enum DisplayEngine {
    // MARK: Filter

    public static func filtered(_ items: [TaskListItem], _ filters: DisplayFilters, _ context: DisplayContext) -> [TaskListItem] {
        guard filters.isActive else { return items }
        return items.filter { passes($0, filters, context) }
    }

    private static func passes(_ item: TaskListItem, _ filters: DisplayFilters, _ context: DisplayContext) -> Bool {
        let task = item.task
        if !filters.priorities.isEmpty, !filters.priorities.contains(task.priority) { return false }
        if !matches(task.dueDate, filters.dueDate, context) { return false }
        if !matches(task.endDate, filters.deadline, context) { return false }
        if !filters.projectIds.isEmpty, !filters.projectIds.contains(task.projectLocalId) { return false }
        if !filters.labelIds.isEmpty, filters.labelIds.isDisjoint(with: item.labels.map(\.localId)) { return false }
        let assigned = context.assigneesByTask[task.localId] ?? []
        switch filters.assignee {
        case .all: break
        case .unassigned: if !assigned.isEmpty { return false }
        case .assignedToMe:
            guard let user = context.currentUserId, assigned.contains(user) else { return false }
        }
        return true
    }

    /// Overdue and Today compare calendar days; This week is today through the next six days.
    static func matches(_ iso: String?, _ filter: DisplayDateFilter, _ context: DisplayContext) -> Bool {
        switch filter {
        case .all: return true
        case .none: return iso == nil || iso?.isEmpty == true
        case .overdue, .today, .week:
            guard let iso, let day = DueDates.calendarDate(iso, calendar: context.calendar) else { return false }
            let today = context.calendar.startOfDay(for: context.now)
            switch filter {
            case .overdue: return day < today
            case .today: return day == today
            default:
                let end = context.calendar.date(byAdding: .day, value: 7, to: today) ?? today
                return day >= today && day < end
            }
        }
    }

    // MARK: Sort

    /// Stable, with open tasks ahead of done ones. Manual keeps the order it was given (the store's order) and
    /// reverses it when descending.
    public static func sorted(_ items: [TaskListItem], by sort: DisplaySort) -> [TaskListItem] {
        let ordered: [TaskListItem]
        switch sort.field {
        case .manual:
            ordered = sort.descending ? items.reversed() : items
        case .smart:
            ordered = smartSorted(items)
        default:
            let byId = Dictionary(items.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
            ordered = TaskSort.sorted(items.map(\.task), by: sort.rule).compactMap { byId[$0.localId] }
        }
        return ordered.filter { !$0.task.done } + ordered.filter(\.task.done)
    }

    private static func smartSorted(_ items: [TaskListItem]) -> [TaskListItem] {
        items.enumerated().sorted { left, right in
            let first = left.element.task
            let second = right.element.task
            var result = SortValue.compare(SortValue.date(first.dueDate), SortValue.date(second.dueDate), direction: .asc)
            if result == 0 { result = second.priority - first.priority }
            if result == 0 {
                switch first.title.localizedCaseInsensitiveCompare(second.title) {
                case .orderedAscending: result = -1
                case .orderedDescending: result = 1
                case .orderedSame: result = 0
                }
            }
            return result == 0 ? left.offset < right.offset : result < 0
        }.map(\.element)
    }

    // MARK: Group

    private static let priorityNames = ["No priority", "Low", "Medium", "High", "Urgent", "Do now"]

    private struct GroupKey {
        let key: String
        let label: String
        /// Sections are ordered by this, then by label.
        let order: String
    }

    /// Splits a list into sections. Priorities run highest first, dates run in time order, projects and labels
    /// alphabetically with "No project" and "No label" last. A task with several labels appears under each.
    public static func grouped(_ items: [TaskListItem], by groupBy: DisplayGroupBy, context: DisplayContext) -> [DisplaySection] {
        guard groupBy != .none else { return items.isEmpty ? [] : [DisplaySection(key: "all", label: "", items: items)] }
        var buckets: [String: DisplaySection] = [:]
        var order: [String: String] = [:]
        for item in items {
            for group in keys(for: item, groupBy, context) {
                buckets[group.key, default: DisplaySection(key: group.key, label: group.label, items: [])].items.append(item)
                order[group.key] = group.order
            }
        }
        return buckets.values.sorted {
            let left = order[$0.key] ?? ""
            let right = order[$1.key] ?? ""
            return left == right ? $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending : left < right
        }
    }

    private static func keys(for item: TaskListItem, _ groupBy: DisplayGroupBy, _ context: DisplayContext) -> [GroupKey] {
        let task = item.task
        switch groupBy {
        case .none:
            return [GroupKey(key: "all", label: "", order: "")]
        case .priority:
            let level = min(max(task.priority, 0), priorityNames.count - 1)
            return [GroupKey(key: "p\(level)", label: priorityNames[level], order: String(priorityNames.count - level))]
        case .dueDate:
            return [dateKey(task.dueDate, context)]
        case .project:
            guard let title = item.projectTitle else { return [GroupKey(key: "none", label: "No project", order: "~")] }
            return [GroupKey(key: task.projectLocalId, label: title, order: title.lowercased())]
        case .label:
            guard !item.labels.isEmpty else { return [GroupKey(key: "none", label: "No label", order: "~")] }
            return item.labels.map { GroupKey(key: $0.localId, label: $0.title, order: $0.title.lowercased()) }
        }
    }

    private static func dateKey(_ iso: String?, _ context: DisplayContext) -> GroupKey {
        let calendar = context.calendar
        guard let iso, let day = DueDates.calendarDate(iso, calendar: calendar) else {
            return GroupKey(key: "none", label: "No date", order: "9")
        }
        let today = calendar.startOfDay(for: context.now)
        if day < today { return GroupKey(key: "overdue", label: "Overdue", order: "0") }
        if day == today { return GroupKey(key: "today", label: "Today", order: "1") }
        let key = DueDates.dayKey(iso, calendar: calendar) ?? "later"
        let label = DueDates.label(DueDates.allDayISO(for: day, calendar: calendar), now: context.now, calendar: calendar)
        let isTomorrow = day == calendar.date(byAdding: .day, value: 1, to: today)
        return GroupKey(key: key, label: label, order: isTomorrow ? "2" : "3-\(key)")
    }

    // MARK: Whole pipeline

    /// Filter, drop done tasks unless `showCompleted`, and sort.
    public static func visible(
        _ items: [TaskListItem], config: DisplayConfig, showCompleted: Bool, context: DisplayContext
    ) -> [TaskListItem] {
        let matched = filtered(items, config.filters, context)
        return sorted(showCompleted ? matched : matched.filter { !$0.task.done }, by: config.sort)
    }

    /// `visible`, then grouped by the config's grouping.
    public static func sections(
        _ items: [TaskListItem], config: DisplayConfig, showCompleted: Bool, context: DisplayContext
    ) -> [DisplaySection] {
        grouped(visible(items, config: config, showCompleted: showCompleted, context: context), by: config.groupBy, context: context)
    }

    /// For lists that already have their own sections (Today's overdue and due, Upcoming's days): filter and sort
    /// inside each one and drop the sections left empty.
    public static func refined(
        _ sections: [DisplaySection], config: DisplayConfig, showCompleted: Bool, context: DisplayContext
    ) -> [DisplaySection] {
        sections.compactMap { section in
            let items = visible(section.items, config: config, showCompleted: showCompleted, context: context)
            return items.isEmpty ? nil : DisplaySection(key: section.key, label: section.label, items: items)
        }
    }
}
