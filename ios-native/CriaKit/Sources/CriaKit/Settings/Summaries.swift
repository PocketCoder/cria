import Foundation

/// The slice of a task the morning summary and weekly round-up need.
public struct SummaryTask: Equatable, Sendable {
    public var title: String
    public var dueDate: String?
    public var done: Bool
    public var doneAt: String?

    public init(title: String, dueDate: String?, done: Bool, doneAt: String? = nil) {
        self.title = title
        self.dueDate = dueDate
        self.done = done
        self.doneAt = doneAt
    }
}

public struct SummaryMessage: Equatable, Sendable {
    public var title: String
    public var body: String

    public init(title: String, body: String) {
        self.title = title
        self.body = body
    }
}

/// Settings the summaries are planned from.
public struct SummaryConfig: Equatable, Sendable {
    public var notificationsEnabled: Bool
    public var morningEnabled: Bool
    public var morningTime: String
    public var weeklyEnabled: Bool
    public var weeklyTime: String
    /// 0 = Sunday ... 6 = Saturday; the weekly round-up lands on this day.
    public var weekStart: Int

    public init(notificationsEnabled: Bool, morningEnabled: Bool, morningTime: String,
                weeklyEnabled: Bool, weeklyTime: String, weekStart: Int) {
        self.notificationsEnabled = notificationsEnabled
        self.morningEnabled = morningEnabled
        self.morningTime = morningTime
        self.weeklyEnabled = weeklyEnabled
        self.weeklyTime = weeklyTime
        self.weekStart = weekStart
    }

    public init(preferences: LocalPreferences, weekStart: Int) {
        self.init(notificationsEnabled: preferences.notificationsEnabled,
                  morningEnabled: preferences.morningSummaryEnabled, morningTime: preferences.morningSummaryTime,
                  weeklyEnabled: preferences.weeklyRoundupEnabled, weeklyTime: preferences.weeklyRoundupTime,
                  weekStart: weekStart)
    }
}

/// One summary notification to hand to the OS.
public struct PlannedSummary: Equatable, Sendable {
    public var identifier: String
    public var fireDate: Date
    public var message: SummaryMessage
}

/// Morning summary and weekly round-up content and timing. Ported from `src/lib/summaries.ts`; pure, so the app-side
/// scheduler only has to hand the result to `UNUserNotificationCenter`.
public enum Summaries {
    public static let morningIdentifier = "cria.summary.morning"
    public static let weeklyIdentifier = "cria.summary.weekly"
    public static let identifiers = [morningIdentifier, weeklyIdentifier]

    /// The next moment strictly after `now` at `time` ("HH:mm"), on `weekday` (0 = Sunday) when given.
    public static func nextFire(after now: Date, time: String, weekday: Int? = nil, calendar: Calendar = .cria) -> Date? {
        let clock = parseTime(time)
        var parts = DateComponents(hour: clock.hour, minute: clock.minute, second: 0)
        if let weekday, (0...6).contains(weekday) { parts.weekday = weekday + 1 }
        return calendar.nextDate(after: now, matching: parts, matchingPolicy: .nextTime)
    }

    /// Falls back to 08:00 for anything that is not "HH:mm".
    static func parseTime(_ time: String) -> (hour: Int, minute: Int) {
        guard LocalPreferences.isClockTime(time) else { return (8, 0) }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        return (parts[0], parts[1])
    }

    public static func morning(_ tasks: [SummaryTask], now: Date, calendar: Calendar = .cria) -> SummaryMessage {
        let buckets = bucket(tasks, now: now, calendar: calendar)
        if buckets.today.isEmpty && buckets.overdue.isEmpty {
            return SummaryMessage(title: "Good morning", body: "Nothing due today.")
        }
        var parts: [String] = []
        if !buckets.today.isEmpty { parts.append("\(buckets.today.count) due today") }
        if !buckets.overdue.isEmpty { parts.append("\(buckets.overdue.count) overdue") }
        let first = (buckets.today.first ?? buckets.overdue.first)?.title ?? ""
        return SummaryMessage(title: "Today", body: "\(parts.joined(separator: ", ")).\(first.isEmpty ? "" : " Start with: \(first)")")
    }

    public static func weekly(_ tasks: [SummaryTask], now: Date, calendar: Calendar = .cria) -> SummaryMessage {
        let start = calendar.startOfDay(for: now)
        let horizon = calendar.date(byAdding: .day, value: 7, to: start) ?? start
        let lastWeek = calendar.date(byAdding: .day, value: -7, to: now) ?? now
        var ahead = 0
        var done = 0
        for task in tasks {
            if task.done {
                if let stamp = task.doneAt.flatMap(DueDates.parse), stamp >= lastWeek, stamp <= now { done += 1 }
            } else if let day = task.dueDate.flatMap({ DueDates.calendarDate($0, calendar: calendar) }), day >= start, day < horizon {
                ahead += 1
            }
        }
        let overdue = bucket(tasks, now: now, calendar: calendar).overdue.count
        var parts = ["\(done) \(done == 1 ? "task" : "tasks") done last week", "\(ahead) due in the next 7 days"]
        if overdue > 0 { parts.append("\(overdue) overdue") }
        return SummaryMessage(title: "Your week", body: "\(parts.joined(separator: ", ")).")
    }

    /// The notifications that should be pending: none when notifications are off, else one per enabled summary, at its
    /// next fire time with the content as it reads then.
    public static func plan(_ config: SummaryConfig, tasks: [SummaryTask], now: Date, calendar: Calendar = .cria) -> [PlannedSummary] {
        guard config.notificationsEnabled else { return [] }
        var planned: [PlannedSummary] = []
        if config.morningEnabled, let fire = nextFire(after: now, time: config.morningTime, calendar: calendar) {
            planned.append(PlannedSummary(identifier: morningIdentifier, fireDate: fire,
                                          message: morning(tasks, now: fire, calendar: calendar)))
        }
        if config.weeklyEnabled,
           let fire = nextFire(after: now, time: config.weeklyTime, weekday: config.weekStart, calendar: calendar) {
            planned.append(PlannedSummary(identifier: weeklyIdentifier, fireDate: fire,
                                          message: weekly(tasks, now: fire, calendar: calendar)))
        }
        return planned
    }

    private static func bucket(_ tasks: [SummaryTask], now: Date, calendar: Calendar) -> (overdue: [SummaryTask], today: [SummaryTask]) {
        let start = calendar.startOfDay(for: now)
        var overdue: [SummaryTask] = []
        var today: [SummaryTask] = []
        for task in tasks where !task.done {
            guard let due = task.dueDate, let day = DueDates.calendarDate(due, calendar: calendar) else { continue }
            if day < start { overdue.append(task) } else if day == start { today.append(task) }
        }
        return (overdue, today)
    }
}
