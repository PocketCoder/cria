import Foundation

/// What a swipe on a task row does.
public enum SwipeAction: String, CaseIterable, Sendable {
    case none, complete, schedule, star, delete

    public var title: String {
        switch self {
        case .none: return "None"
        case .complete: return "Complete"
        case .schedule: return "Schedule"
        case .star: return "Star"
        case .delete: return "Delete"
        }
    }
}

/// A chip in quick add's row. Ones left out of the row move to its ••• menu.
public enum QuickAddAction: String, CaseIterable, Sendable, Identifiable {
    case date, priority, reminders, labels
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .date: return "Date"
        case .priority: return "Priority"
        case .reminders: return "Reminders"
        case .labels: return "Labels"
        }
    }
}

/// The sound a completed task plays, when that is on.
public enum CompletionTone: String, CaseIterable, Sendable {
    case tink, tweet, bloom, calypso, fanfare, spell

    public var title: String { rawValue.capitalized }
}

/// Cria's own settings, mirrored from Todoist: navigation, quick add, swipes, date phrases and link handling. Kept in
/// `frontend_settings.cria` under flat keys (the same `values` shape as `LocalPreferences`), so they follow the
/// account to other Cria installs. Vikunja-web has no equivalent for any of them.
public struct Customisation: Equatable, Sendable {
    /// Tabs the user can place in the bar, in order. Browse (which holds Settings) and Search are always there.
    public static let tabChoices: [AppTab] = [.inbox, .today, .upcoming, .favorites]
    /// With Browse and Search that makes five, the most the bar shows without a More tab.
    public static let maxChosenTabs = 3

    public var tabs: [AppTab] = [.today, .upcoming]
    /// The tab the app opens on.
    public var homeView: AppTab = .today
    /// When off, the home view stays on this device and ignores the account's.
    public var syncHomeView = true
    public var showTaskCount = false
    public var swipeRight: SwipeAction = .complete
    public var swipeLeft: SwipeAction = .delete
    public var quickAddShowsLabels = true
    public var quickAddActions: [QuickAddAction] = QuickAddAction.allCases
    /// Quick add reads dates out of the typed title ("tomorrow 5pm").
    public var detectDates = true
    /// 0 is "same day next week"; 1 to 7 is that weekday of next week (Calendar numbering, 2 is Monday).
    public var nextWeekDay = 0
    /// 7 is Saturday, 1 is Sunday.
    public var weekendDay = 7
    public var resetSubtasksOnRepeat = false
    public var openLinksInApp = false
    public var completionTone: CompletionTone = .tink
    /// Boards list each column's cards soonest due first (no date last) instead of in the order they were dragged to.
    public var kanbanSortByDue = false
    /// When a day-based reminder ("1 day before") goes off, in minutes after midnight. 540 is 09:00.
    public var dayReminderMinute = 540
    /// Reopen each project on the view last used in it on any of the account's devices. Stays on the device: each one
    /// chooses whether to take part.
    public var syncProjectViews = false

    public static let `default` = Customisation()

    public init() {}

    /// The tabs the bar shows, in order: the chosen ones, then Browse, then Search.
    public var barTabs: [AppTab] { Array(tabs.prefix(Self.maxChosenTabs)) + [.browse, .search] }

    /// The home view when it is in the bar, else the bar's first tab.
    public var launchTab: AppTab { barTabs.contains(homeView) ? homeView : barTabs[0] }

    public var rules: CriaRules {
        CriaRules(
            nextWeekWeekday: (1...7).contains(nextWeekDay) ? nextWeekDay : nil,
            weekendWeekday: weekendDay == 1 ? 1 : 7,
            resetsSubtasksOnRepeat: resetSubtasksOnRepeat,
            dayReminderMinute: dayReminderMinute
        )
    }

    /// Keys that follow the account. `syncHomeView` itself stays on the device, and `homeView` only travels while it is on.
    static let syncedKeys = [
        "tabs", "showTaskCount", "swipeRight", "swipeLeft", "quickAddShowsLabels", "quickAddActions", "detectDates",
        "nextWeekDay", "weekendDay", "resetSubtasksOnRepeat", "openLinksInApp", "completionTone", "kanbanSortByDue",
        "dayReminderMinute"
    ]
    static let homeViewKey = "homeView"

    init(values: JSONBody) {
        func text(_ key: String) -> String? { values[key]?.stringValue }
        func flag(_ key: String, _ fallback: Bool) -> Bool {
            if case .bool(let value)? = values[key] { return value }
            return fallback
        }
        func number(_ key: String, _ fallback: Int, in range: ClosedRange<Int>) -> Int {
            if case .number(let value)? = values[key], range.contains(Int(value)) { return Int(value) }
            return fallback
        }
        let base = Self.default
        if let raw = text("tabs") {
            let chosen = Self.list(raw, AppTab.init(rawValue:)).filter { Self.tabChoices.contains($0) }
            tabs = Array(chosen.prefix(Self.maxChosenTabs))
        }
        homeView = text(Self.homeViewKey).flatMap(AppTab.init(rawValue:)) ?? base.homeView
        syncHomeView = flag("syncHomeView", base.syncHomeView)
        showTaskCount = flag("showTaskCount", base.showTaskCount)
        swipeRight = text("swipeRight").flatMap(SwipeAction.init(rawValue:)) ?? base.swipeRight
        swipeLeft = text("swipeLeft").flatMap(SwipeAction.init(rawValue:)) ?? base.swipeLeft
        quickAddShowsLabels = flag("quickAddShowsLabels", base.quickAddShowsLabels)
        if let raw = text("quickAddActions") { quickAddActions = Self.list(raw, QuickAddAction.init(rawValue:)) }
        detectDates = flag("detectDates", base.detectDates)
        nextWeekDay = number("nextWeekDay", base.nextWeekDay, in: 0...7)
        weekendDay = number("weekendDay", base.weekendDay, in: 1...7) == 1 ? 1 : 7
        resetSubtasksOnRepeat = flag("resetSubtasksOnRepeat", base.resetSubtasksOnRepeat)
        openLinksInApp = flag("openLinksInApp", base.openLinksInApp)
        completionTone = text("completionTone").flatMap(CompletionTone.init(rawValue:)) ?? base.completionTone
        kanbanSortByDue = flag("kanbanSortByDue", base.kanbanSortByDue)
        dayReminderMinute = number("dayReminderMinute", base.dayReminderMinute, in: 0...1439)
        syncProjectViews = flag("syncProjectViews", base.syncProjectViews)
    }

    var values: JSONBody {
        [
            "tabs": .string(tabs.map(\.rawValue).joined(separator: ",")),
            Self.homeViewKey: .string(homeView.rawValue),
            "syncHomeView": .bool(syncHomeView),
            "showTaskCount": .bool(showTaskCount),
            "swipeRight": .string(swipeRight.rawValue),
            "swipeLeft": .string(swipeLeft.rawValue),
            "quickAddShowsLabels": .bool(quickAddShowsLabels),
            "quickAddActions": .string(quickAddActions.map(\.rawValue).joined(separator: ",")),
            "detectDates": .bool(detectDates),
            "nextWeekDay": .number(Double(nextWeekDay)),
            "weekendDay": .number(Double(weekendDay)),
            "resetSubtasksOnRepeat": .bool(resetSubtasksOnRepeat),
            "openLinksInApp": .bool(openLinksInApp),
            "completionTone": .string(completionTone.rawValue),
            "kanbanSortByDue": .bool(kanbanSortByDue),
            "dayReminderMinute": .number(Double(dayReminderMinute)),
            "syncProjectViews": .bool(syncProjectViews)
        ]
    }

    /// A comma-joined list: unknown and repeated names are dropped.
    private static func list<T: Hashable>(_ raw: String, _ make: (String) -> T?) -> [T] {
        var seen = Set<T>()
        return raw.split(separator: ",").compactMap { make(String($0)) }.filter { seen.insert($0).inserted }
    }
}

/// The settings that change how CriaKit itself behaves, set by the app from `Customisation` whenever the preferences
/// change. A global, because the date parser and the task repository are called from many places.
public struct CriaRules: Equatable, Sendable {
    /// Nil: "next week" is the same weekday a week on. Else that weekday of next week.
    public var nextWeekWeekday: Int?
    /// The day "weekend" means: 7 Saturday, 1 Sunday.
    public var weekendWeekday: Int
    /// Completing a repeating task marks its done subtasks not done again.
    public var resetsSubtasksOnRepeat: Bool
    /// When a day-based reminder goes off, in minutes after midnight.
    public var dayReminderMinute: Int

    public static let standard = CriaRules(nextWeekWeekday: nil, weekendWeekday: 7, resetsSubtasksOnRepeat: false)

    public init(nextWeekWeekday: Int?, weekendWeekday: Int, resetsSubtasksOnRepeat: Bool, dayReminderMinute: Int = 540) {
        self.nextWeekWeekday = nextWeekWeekday
        self.weekendWeekday = weekendWeekday
        self.resetsSubtasksOnRepeat = resetsSubtasksOnRepeat
        self.dayReminderMinute = dayReminderMinute
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var stored = CriaRules.standard

    public static var current: CriaRules {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }

    /// Days from `today` to the day "next week" means.
    func nextWeekOffset(from today: Date, calendar: Calendar) -> Int {
        guard let weekday = nextWeekWeekday else { return 7 }
        return nextWeekdayOffset(weekday, from: calendar.component(.weekday, from: today))
    }

    /// Days from `today` to the coming weekend day (0 when today is that day).
    func weekendOffset(from today: Date, calendar: Calendar) -> Int {
        (weekendWeekday - calendar.component(.weekday, from: today) + 7) % 7
    }
}
