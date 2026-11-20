import Foundation

/// What a list widget shows: a smart view, a project, a saved filter or a label. Stored in the widget's configuration
/// as `id`, so it has to survive a round trip through a string.
public enum WidgetListSource: Hashable, Sendable {
    case today
    case upcoming
    case inbox
    case project(String)
    case savedFilter(Int)
    case label(String)

    /// "today", "upcoming", "inbox", "project:<local id>", "filter:<server id>", "label:<local id>".
    public var id: String {
        switch self {
        case .today: return "today"
        case .upcoming: return "upcoming"
        case .inbox: return "inbox"
        case .project(let localId): return "project:\(localId)"
        case .savedFilter(let serverId): return "filter:\(serverId)"
        case .label(let localId): return "label:\(localId)"
        }
    }

    public init?(id: String) {
        switch id {
        case "today": self = .today
        case "upcoming": self = .upcoming
        case "inbox": self = .inbox
        default:
            let parts = id.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2, !parts[1].isEmpty else { return nil }
            switch parts[0] {
            case "project": self = .project(parts[1])
            case "label": self = .label(parts[1])
            case "filter":
                guard let serverId = Int(parts[1]) else { return nil }
                self = .savedFilter(serverId)
            default: return nil
            }
        }
    }

    /// Where tapping the widget goes.
    public var url: URL? {
        switch self {
        case .today: return DeepLink.todayURL
        case .upcoming: return URL(string: "\(DeepLink.scheme)://upcoming")
        case .inbox: return URL(string: "\(DeepLink.scheme)://inbox")
        case .project(let localId): return DeepLink.projectURL(localId: localId)
        case .savedFilter(let serverId): return URL(string: "\(DeepLink.scheme)://filter/\(serverId)")
        case .label(let localId): return URL(string: "\(DeepLink.scheme)://label/\(localId)")
        }
    }

    /// The kind, for the picker's subtitle and icon.
    public var kind: Kind {
        switch self {
        case .today, .upcoming, .inbox: return .view
        case .project: return .project
        case .savedFilter: return .filter
        case .label: return .label
        }
    }

    public enum Kind: String, Sendable {
        case view = "View"
        case project = "Project"
        case filter = "Saved filter"
        case label = "Label"
    }

    /// Without a due date a task in Today or Upcoming never shows, so those lists say "Nothing due" when empty.
    public var emptyText: String {
        switch self {
        case .today, .upcoming: return "Nothing due"
        default: return "No open tasks"
        }
    }
}

/// One entry in the widget's list picker.
public struct WidgetListChoice: Equatable, Sendable {
    public let source: WidgetListSource
    public let title: String

    public init(source: WidgetListSource, title: String) {
        self.source = source
        self.title = title
    }
}

/// What a list widget shows, read straight from the shared database. Open tasks only, in the order the app lists them.
public struct WidgetListSnapshot: Equatable, Sendable {
    public struct Entry: Equatable, Sendable, Identifiable {
        public let id: String
        public let title: String
        public let isOverdue: Bool
        /// The due date as a row label ("Tomorrow", "Friday"); nil when undated, and in Today, where every row is today.
        public let due: String?

        public init(id: String, title: String, isOverdue: Bool, due: String?) {
            self.id = id
            self.title = title
            self.isOverdue = isOverdue
            self.due = due
        }
    }

    public let title: String
    public let entries: [Entry]
    /// Every open task in the list, including any beyond `entries`.
    public let total: Int
    /// The project, filter or label has gone (deleted, or not synced to this device).
    public let isMissing: Bool

    public init(title: String, entries: [Entry], total: Int, isMissing: Bool = false) {
        self.title = title
        self.entries = entries
        self.total = total
        self.isMissing = isMissing
    }

    public static func load(
        store: CriaStore,
        source: WidgetListSource,
        limit: Int,
        now: Date = Date(),
        calendar: Calendar = .cria,
        defaults: UserDefaults = CriaPaths.sharedDefaults()
    ) throws -> WidgetListSnapshot {
        guard let title = try store.widgetListTitle(source, defaults: defaults) else {
            return WidgetListSnapshot(title: fallbackTitle(source), entries: [], total: 0, isMissing: true)
        }
        let items = try store.widgetListItems(source, now: now, calendar: calendar, defaults: defaults)
        let start = calendar.startOfDay(for: now)
        let entries = items.prefix(limit).map { item in
            let dueISO = item.task.dueDate
            let day = dueISO.flatMap { DueDates.calendarDate($0, calendar: calendar) }
            return Entry(
                id: item.task.localId,
                title: item.task.title,
                isOverdue: day.map { $0 < start } ?? false,
                due: source == .today ? nil : dueISO.map { DueDates.label($0, now: now, calendar: calendar) }
            )
        }
        return WidgetListSnapshot(title: title, entries: entries, total: items.count)
    }

    private static func fallbackTitle(_ source: WidgetListSource) -> String {
        switch source {
        case .today: return "Today"
        case .upcoming: return "Upcoming"
        case .inbox: return "Inbox"
        case .project: return "Project"
        case .savedFilter: return "Saved filter"
        case .label: return "Label"
        }
    }
}

public extension CriaStore {
    /// Every list a widget can show, for the widget's picker: the views, then projects, saved filters and labels by
    /// title. `text` narrows by title (case-insensitive); blank shows everything.
    func widgetListChoices(matching text: String = "") throws -> [WidgetListChoice] {
        let byTitle: (WidgetListChoice, WidgetListChoice) -> Bool = {
            $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
        }
        let views = [
            WidgetListChoice(source: .today, title: "Today"),
            WidgetListChoice(source: .upcoming, title: "Upcoming"),
            WidgetListChoice(source: .inbox, title: "Inbox")
        ]
        let projectChoices = ProjectTree.visible(try projects())
            .map { WidgetListChoice(source: .project($0.localId), title: $0.title) }
            .sorted(by: byTitle)
        let filterChoices = try savedFilters()
            .map { WidgetListChoice(source: .savedFilter($0.serverId), title: $0.title) }
            .sorted(by: byTitle)
        let labelChoices = try labels()
            .map { WidgetListChoice(source: .label($0.localId), title: $0.title) }
            .sorted(by: byTitle)
        let all = views + projectChoices + filterChoices + labelChoices
        let needle = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return all }
        return all.filter { $0.title.localizedCaseInsensitiveContains(needle) }
    }

    /// The list's title, or nil when it no longer exists here. Inbox needs the default project, which the app
    /// remembers once it has asked the server.
    func widgetListTitle(_ source: WidgetListSource, defaults: UserDefaults = CriaPaths.sharedDefaults()) throws -> String? {
        switch source {
        case .today: return "Today"
        case .upcoming: return "Upcoming"
        case .inbox: return try rememberedCaptureProjectId(defaults: defaults) == nil ? nil : "Inbox"
        case .project(let localId):
            return ProjectTree.visible(try projects()).first { $0.localId == localId }?.title
        case .savedFilter(let serverId): return try savedFilter(serverId: serverId)?.title
        case .label(let localId): return try labels().first { $0.localId == localId }?.title
        }
    }

    /// The list's open tasks, in the app's order for that list.
    internal func widgetListItems(
        _ source: WidgetListSource, now: Date, calendar: Calendar, defaults: UserDefaults
    ) throws -> [TaskListItem] {
        let items: [TaskListItem]
        switch source {
        case .today: items = try smartGroups(.today, now: now, calendar: calendar).flatMap(\.items)
        case .upcoming: items = try smartGroups(.upcoming, now: now, calendar: calendar).flatMap(\.items)
        case .inbox:
            guard let localId = try rememberedCaptureProjectId(defaults: defaults) else { return [] }
            items = try taskItems(.project(localId), includeDone: false)
        case .project(let localId): items = try taskItems(.project(localId), includeDone: false)
        case .savedFilter(let serverId):
            items = try smartGroups(.savedFilter(serverId: serverId), now: now, calendar: calendar).flatMap(\.items)
        case .label(let localId): items = try taskItems(.label(localId), includeDone: false)
        }
        // A saved filter that asks for done tasks still shows open ones only: every row has a tick button.
        return items.filter { !$0.task.done }
    }
}
