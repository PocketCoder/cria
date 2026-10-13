import Foundation

/// What Today shows when nothing is left: tasks due in the next week to pull forward, and a few things to work on.
/// Ported from `NothingDue` in `src/features/smart-views/SmartViews.tsx` and `suggestTasks` in `src/lib/summaries.ts`.
public struct TodayEmptyData: Equatable, Sendable {
    /// Open tasks due from tomorrow to a week out, soonest first.
    public var upcoming: [TaskListItem] = []
    /// "You could work on": up to three tasks, undated ones first, then ones due far ahead.
    public var suggestions: [TaskListItem] = []
    /// Tasks due today that are done.
    public var doneToday = 0

    public init() {}
}

public enum TodaySuggestions {
    /// Days out from which a dated task counts as far off.
    public static let farDueDays = 14
    /// Days ahead the pull forward list reaches.
    public static let pullForwardDays = 7

    /// Undated tasks first (highest priority, then oldest), then open tasks due `farDueDays` or more away, nearest
    /// first. Pure, so it can be tested with a pinned clock.
    public static func suggest(
        undated: [TaskListItem], dated: [TaskListItem], now: Date, calendar: Calendar = .cria, limit: Int = 3
    ) -> [TaskListItem] {
        let cutoff = calendar.date(byAdding: .day, value: farDueDays, to: calendar.startOfDay(for: now)) ?? now
        let noDate = undated.filter { !$0.task.done && $0.task.dueDate == nil }.enumerated().sorted { left, right in
            let first = left.element.task
            let second = right.element.task
            if first.priority != second.priority { return first.priority > second.priority }
            let firstCreated = first.createdAt ?? ""
            let secondCreated = second.createdAt ?? ""
            return firstCreated == secondCreated ? left.offset < right.offset : firstCreated < secondCreated
        }.map(\.element)
        let far = dated.compactMap { item -> (Date, TaskListItem)? in
            guard !item.task.done, let iso = item.task.dueDate, let day = DueDates.calendarDate(iso, calendar: calendar),
                  day >= cutoff else { return nil }
            return (day, item)
        }.sorted { $0.0 < $1.0 }.map(\.1)
        return Array((noDate + far).prefix(limit))
    }

    /// Open tasks due after today and within `pullForwardDays`, soonest first.
    public static func pullForwardCandidates(_ dated: [TaskListItem], now: Date, calendar: Calendar = .cria) -> [TaskListItem] {
        let today = calendar.startOfDay(for: now)
        let horizon = calendar.date(byAdding: .day, value: pullForwardDays, to: today) ?? today
        return dated.compactMap { item -> (Date, TaskListItem)? in
            guard !item.task.done, let iso = item.task.dueDate, let day = DueDates.calendarDate(iso, calendar: calendar),
                  day > today, day <= horizon else { return nil }
            return (day, item)
        }.sorted { $0.0 < $1.0 }.map(\.1)
    }

    /// A due date moved to today. A timed one keeps its time of day; an all-day one (or none) stays all-day.
    public static func pulledForward(_ currentDue: String?, now: Date, calendar: Calendar = .cria) -> String {
        guard let currentDue, DueDates.hasTimeOfDay(currentDue), let due = DueDates.parse(currentDue) else {
            return DueDates.allDayISO(for: now, calendar: calendar)
        }
        let time = calendar.dateComponents([.hour, .minute, .second], from: due)
        let moved = calendar.date(
            bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: time.second ?? 0, of: now
        ) ?? now
        return DueDates.timedISO(moved)
    }
}

extension CriaStore {
    public func todayEmptyData(now: Date = Date(), calendar: Calendar = .cria) throws -> TodayEmptyData {
        let dated = try datedTasks(includeDone: true)
        let open = dated.filter { !$0.task.done }
        let today = calendar.startOfDay(for: now)
        var data = TodayEmptyData()
        data.upcoming = TodaySuggestions.pullForwardCandidates(open, now: now, calendar: calendar)
        data.suggestions = TodaySuggestions.suggest(
            undated: try undatedOpenTasks(limit: 20), dated: open, now: now, calendar: calendar
        )
        data.doneToday = dated.filter { item in
            item.task.done && item.task.dueDate.flatMap { DueDates.calendarDate($0, calendar: calendar) } == today
        }.count
        return data
    }
}
