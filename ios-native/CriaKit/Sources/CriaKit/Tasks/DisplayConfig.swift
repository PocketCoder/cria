import Foundation

// Per-view display options (group, sort, filters, show completed). Ported from `src/lib/displayConfig.ts` and
// `src/stores/display.ts`. The model, its defaults and its persistence live here; `DisplayEngine` applies it.

/// How a list is split into sections.
public enum DisplayGroupBy: String, Codable, CaseIterable, Sendable {
    case none, priority, dueDate, project, label

    public var title: String {
        switch self {
        case .none: return "None"
        case .priority: return "Priority"
        case .dueDate: return "Due date"
        case .project: return "Project"
        case .label: return "Label"
        }
    }
}

/// A date constraint for the due date or the end date ("deadline").
public enum DisplayDateFilter: String, Codable, CaseIterable, Sendable {
    case all, overdue, today, week, none

    public var title: String {
        switch self {
        case .all: return "All"
        case .overdue: return "Overdue"
        case .today: return "Today"
        case .week: return "This week"
        case .none: return "No date"
        }
    }
}

public enum DisplayAssigneeFilter: String, Codable, CaseIterable, Sendable {
    case all
    case assignedToMe = "me"
    case unassigned

    public var title: String {
        switch self {
        case .all: return "Anyone"
        case .assignedToMe: return "Assigned to me"
        case .unassigned: return "Unassigned"
        }
    }
}

public enum DisplaySortField: String, Codable, CaseIterable, Sendable {
    /// Earliest due date first (no date last), then highest priority, then title.
    case smart
    /// The order the list was stored in (positions, then due date, then title).
    case manual
    case dueDate, endDate, startDate, priority, title, created, updated, percentDone
}

/// A sort choice. Everything `TaskSort.options` offers, plus Smart.
public struct DisplaySort: Codable, Equatable, Hashable, Sendable {
    public var field: DisplaySortField
    public var descending: Bool

    public init(field: DisplaySortField, descending: Bool = false) {
        self.field = field
        self.descending = descending
    }

    public static let smart = DisplaySort(field: .smart)
    public static let manual = DisplaySort(field: .manual)

    public var isManual: Bool { field == .manual && !descending }

    /// Smart first, then the list sorts the app already had (Manually, % done, Created, Due date and so on).
    public static let options: [DisplaySort] = [.smart] + TaskSort.options.map { DisplaySort(rule: $0.rule) }

    public var title: String {
        if field == .smart { return "Smart" }
        return TaskSort.options.first { DisplaySort(rule: $0.rule) == self }?.label ?? field.rawValue
    }

    /// The equivalent `TaskSort` rule, nil for Smart.
    public var rule: SortRule? {
        let direction: SortDirection = descending ? .desc : .asc
        switch field {
        case .smart: return nil
        case .manual: return SortRule(field: .userDefinedOrder, direction: direction)
        case .dueDate: return SortRule(field: .dueDate, direction: direction)
        case .endDate: return SortRule(field: .endDate, direction: direction)
        case .startDate: return SortRule(field: .startDate, direction: direction)
        case .priority: return SortRule(field: .priority, direction: direction)
        case .title: return SortRule(field: .title, direction: direction)
        case .created: return SortRule(field: .created, direction: direction)
        case .updated: return SortRule(field: .updated, direction: direction)
        case .percentDone: return SortRule(field: .percentDone, direction: direction)
        }
    }

    init(rule: SortRule) {
        let mapped: DisplaySortField
        switch rule.field {
        case .userDefinedOrder: mapped = .manual
        case .percentDone: mapped = .percentDone
        case .created: mapped = .created
        case .dueDate: mapped = .dueDate
        case .endDate: mapped = .endDate
        case .priority: mapped = .priority
        case .startDate: mapped = .startDate
        case .title: mapped = .title
        case .updated: mapped = .updated
        }
        self.init(field: mapped, descending: rule.direction == .desc)
    }
}

/// What a view hides. An empty set or `.all` means no constraint.
public struct DisplayFilters: Codable, Equatable, Sendable {
    /// Priority values (0 to 5) to keep.
    public var priorities: Set<Int> = []
    public var dueDate: DisplayDateFilter = .all
    /// The end date, which Vikunja calls the deadline.
    public var deadline: DisplayDateFilter = .all
    /// Label local ids: a task passes when it carries any of them.
    public var labelIds: Set<String> = []
    public var projectIds: Set<String> = []
    public var assignee: DisplayAssigneeFilter = .all

    public init() {}

    public var isActive: Bool { self != DisplayFilters() }

    private enum CodingKeys: String, CodingKey {
        case priorities, dueDate, deadline, labelIds, projectIds, assignee
    }

    /// Tolerant of missing keys, so a field added later does not reset what was saved.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        priorities = try container.decodeIfPresent(Set<Int>.self, forKey: .priorities) ?? []
        dueDate = try container.decodeIfPresent(DisplayDateFilter.self, forKey: .dueDate) ?? .all
        deadline = try container.decodeIfPresent(DisplayDateFilter.self, forKey: .deadline) ?? .all
        labelIds = try container.decodeIfPresent(Set<String>.self, forKey: .labelIds) ?? []
        projectIds = try container.decodeIfPresent(Set<String>.self, forKey: .projectIds) ?? []
        assignee = try container.decodeIfPresent(DisplayAssigneeFilter.self, forKey: .assignee) ?? .all
    }
}

/// One view's display options.
public struct DisplayConfig: Codable, Equatable, Sendable {
    /// Nil follows Settings > General > Show completed; a switch in the Display sheet makes it explicit.
    public var showCompleted: Bool?
    public var groupBy: DisplayGroupBy
    public var sort: DisplaySort
    public var filters: DisplayFilters

    public init(
        showCompleted: Bool? = nil, groupBy: DisplayGroupBy = .none, sort: DisplaySort = .smart,
        filters: DisplayFilters = DisplayFilters()
    ) {
        self.showCompleted = showCompleted
        self.groupBy = groupBy
        self.sort = sort
        self.filters = filters
    }

    /// Projects open in manual order (so drag to reorder keeps working), labels and favourites group by project,
    /// everything else sorts Smart.
    public static func defaults(for key: DisplayViewKey) -> DisplayConfig {
        switch key.kind {
        case .project: return DisplayConfig(sort: .manual)
        case .label, .favorites: return DisplayConfig(groupBy: .project)
        default: return DisplayConfig()
        }
    }

    /// True when anything beyond the defaults is set, for the toolbar button's "on" state.
    public func isCustomised(for key: DisplayViewKey) -> Bool {
        self != DisplayConfig.defaults(for: key)
    }

    private enum CodingKeys: String, CodingKey {
        case showCompleted, groupBy, sort, filters
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        showCompleted = try container.decodeIfPresent(Bool.self, forKey: .showCompleted)
        groupBy = try container.decodeIfPresent(DisplayGroupBy.self, forKey: .groupBy) ?? .none
        sort = try container.decodeIfPresent(DisplaySort.self, forKey: .sort) ?? .smart
        filters = try container.decodeIfPresent(DisplayFilters.self, forKey: .filters) ?? DisplayFilters()
    }
}

/// What a view is, as far as display options go.
public enum DisplayViewKind: String, Sendable {
    case inbox, today, upcoming, favorites, project, label, savedFilter
}

/// The key a view's options are saved under: stable across launches, one per view.
public struct DisplayViewKey: Hashable, Sendable {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public static let inbox = DisplayViewKey(rawValue: "inbox")
    public static let today = DisplayViewKey(rawValue: "today")
    public static let upcoming = DisplayViewKey(rawValue: "upcoming")
    public static let favorites = DisplayViewKey(rawValue: "favorites")
    public static func project(_ localId: String) -> DisplayViewKey { DisplayViewKey(rawValue: "project:\(localId)") }
    public static func label(_ localId: String) -> DisplayViewKey { DisplayViewKey(rawValue: "label:\(localId)") }
    public static func savedFilter(serverId: Int) -> DisplayViewKey { DisplayViewKey(rawValue: "filter:\(serverId)") }

    public var kind: DisplayViewKind {
        if rawValue.hasPrefix("project:") { return .project }
        if rawValue.hasPrefix("label:") { return .label }
        if rawValue.hasPrefix("filter:") { return .savedFilter }
        return DisplayViewKind(rawValue: rawValue) ?? .inbox
    }

    /// The key for a smart view. An inbox with no default project yet still has the one inbox key.
    public static func smartView(_ view: SmartView) -> DisplayViewKey {
        switch view {
        case .today: return .today
        case .upcoming: return .upcoming
        case .inbox: return .inbox
        case .savedFilter(let serverId): return .savedFilter(serverId: serverId)
        }
    }

    public static func taskList(_ source: TaskListSource) -> DisplayViewKey {
        switch source {
        case .project(let localId): return .project(localId)
        case .favorites: return .favorites
        case .label(let localId): return .label(localId)
        }
    }
}

/// Which controls the Display sheet offers for a view.
public struct DisplaySections: Equatable, Sendable {
    /// Grouping choices; empty hides the Group row (Today and Upcoming already group by day).
    public var groupings: [DisplayGroupBy]
    /// The Show completed switch. Not offered for saved filters: the filter's query decides whether done tasks match.
    public var completed: Bool
    public var dueDate: Bool
    public var deadline = true
    public var priority = true
    public var label = true
    public var project: Bool
    public var assignee = true

    public init(for key: DisplayViewKey) {
        let withoutProject: [DisplayGroupBy] = [.none, .priority, .dueDate, .label]
        switch key.kind {
        case .today, .upcoming:
            // The sections are the days, and a due date filter would only repeat them.
            self.init(groupings: [], completed: true, dueDate: false, project: true)
        case .project, .inbox:
            self.init(groupings: withoutProject, completed: true, dueDate: true, project: false)
        case .label, .favorites:
            self.init(groupings: DisplayGroupBy.allCases, completed: true, dueDate: true, project: true)
        case .savedFilter:
            self.init(groupings: DisplayGroupBy.allCases, completed: false, dueDate: true, project: true)
        }
    }

    private init(groupings: [DisplayGroupBy], completed: Bool, dueDate: Bool, project: Bool) {
        self.groupings = groupings
        self.completed = completed
        self.dueDate = dueDate
        self.project = project
    }
}

/// Saves each view's `DisplayConfig` on this device, in `UserDefaults`, keyed by `DisplayViewKey`. It does not sync:
/// another iPhone, the desktop app and Vikunja-web each keep their own display options.
public enum DisplayConfigStore {
    static let defaultsKey = "cria.display.configs"

    /// The saved options for a view, else its defaults. Unreadable data falls back to the defaults.
    public static func load(_ key: DisplayViewKey, defaults: UserDefaults = .standard) -> DisplayConfig {
        all(defaults)[key.rawValue] ?? DisplayConfig.defaults(for: key)
    }

    /// Saves a view's options. Options equal to the defaults are removed rather than stored, so a later change to a
    /// default reaches views the user never touched.
    public static func save(_ config: DisplayConfig, for key: DisplayViewKey, defaults: UserDefaults = .standard) {
        var stored = all(defaults)
        if config == DisplayConfig.defaults(for: key) {
            stored.removeValue(forKey: key.rawValue)
        } else {
            stored[key.rawValue] = config
        }
        write(stored, defaults)
    }

    public static func reset(_ key: DisplayViewKey, defaults: UserDefaults = .standard) {
        save(DisplayConfig.defaults(for: key), for: key, defaults: defaults)
    }

    private static func all(_ defaults: UserDefaults) -> [String: DisplayConfig] {
        guard let data = defaults.data(forKey: defaultsKey),
              let decoded = try? JSONDecoder().decode([String: DisplayConfig].self, from: data) else { return [:] }
        return decoded
    }

    private static func write(_ stored: [String: DisplayConfig], _ defaults: UserDefaults) {
        if stored.isEmpty {
            defaults.removeObject(forKey: defaultsKey)
        } else if let data = try? JSONEncoder().encode(stored) {
            defaults.set(data, forKey: defaultsKey)
        }
    }
}
