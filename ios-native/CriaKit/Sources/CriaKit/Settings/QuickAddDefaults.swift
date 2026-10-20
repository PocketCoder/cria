import Foundation

/// A time of day, "HH:mm", that a due date without a time gets. Vikunja-web's `default_due_time`.
public struct DefaultDueTime: Equatable, Sendable {
    public let hour: Int
    public let minute: Int

    public init?(hour: Int, minute: Int) {
        guard (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        self.hour = hour
        self.minute = minute
    }

    /// Strictly "HH:mm" with two digits each, as `parseUserDefaultTime` in Vikunja-web reads it; anything else is nil.
    public init?(text: String) {
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        self.init(hour: hour, minute: minute)
    }

    public var text: String { String(format: "%02d:%02d", hour, minute) }

    /// `iso` with this time on its day when it is an all-day value; a value that already has a time is left alone.
    public func applying(to iso: String, calendar: Calendar = .cria) -> String {
        guard !DueDates.hasTimeOfDay(iso), let day = DueDates.calendarDate(iso, calendar: calendar),
              let timed = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) else { return iso }
        return DueDates.timedISO(timed)
    }

    /// This time on `day` (today by default), for a time picker that starts from the account's default.
    public func date(on day: Date = Date(), calendar: Calendar = .cria) -> Date {
        calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
    }
}

/// The new-task defaults Vikunja keeps in `settings.frontend_settings`, under Vikunja-web's own keys so the web app and
/// Cria share them (Settings > General in Vikunja-web):
///
/// - `default_due_time`: "HH:mm", or "" for none. Vikunja-web applies it to a quick-add date typed without a time
///   (`getDateWithTime` / `addTimeToDate` in `quickAddMagic/dateParser.ts`, for weekdays, "next month", "in 3 days" and
///   the like) and uses it as the time a calendar day click starts from. Without it Vikunja-web falls back to the
///   nearest hour for some phrases; Cria keeps a bare date all-day then, as it always has.
/// - `quick_add_default_reminders`: `[{"relative_period": seconds}]`, each relative to the due date (negative is
///   before it). Vikunja-web gives them to a quick-add task that has a due date (`buildDefaultRemindersForQuickAdd`)
///   and to none that has not.
public struct QuickAddDefaults: Equatable, Sendable {
    public static let dueTimeKey = "default_due_time"
    public static let remindersKey = "quick_add_default_reminders"
    /// The UserDefaults key the quick-add and date screens read the due time from ("" for none).
    public static let dueTimeDefaultsKey = "cria.defaultDueTime"
    /// The UserDefaults key the quick-add screens read the reminder periods from (`[Int]`).
    public static let remindersDefaultsKey = "cria.quickAddDefaultReminders"
    /// The Mac-only, device-local default reminder this replaces: seconds before the due date, -1 for none.
    public static let legacyMacReminderKey = "cria.mac.defaultReminder"

    public var dueTime: DefaultDueTime?
    /// Seconds from the due date, negative before it, in the order the server holds them.
    public var reminderPeriods: [Int]

    public init(dueTime: DefaultDueTime? = nil, reminderPeriods: [Int] = []) {
        self.dueTime = dueTime
        self.reminderPeriods = reminderPeriods
    }

    /// From a `frontend_settings` object. Unset or malformed values read as none.
    public init(frontend: JSONBody) {
        dueTime = frontend[Self.dueTimeKey]?.stringValue.flatMap { DefaultDueTime(text: $0) }
        reminderPeriods = (frontend[Self.remindersKey]?.arrayValue ?? []).compactMap { $0["relative_period"]?.intValue }
    }

    /// The reminders to give a quick-add task that has a due date, relative to it.
    public var reminders: [QuickAddReminder] {
        reminderPeriods.map { .beforeDue(seconds: -$0) }
    }

    // MARK: Writing

    /// Sets the time. `nil` writes "" (a merge-patch cannot delete a key here), which Vikunja-web reads as none.
    public static func changeDueTime(_ time: DefaultDueTime?) -> SettingsChange {
        SettingsChange(frontend: [dueTimeKey: .string(time?.text ?? "")])
    }

    /// Replaces the whole list, as Vikunja-web's form does. Only `relative_period` is stored, as there.
    public static func changeReminders(_ periods: [Int]) -> SettingsChange {
        let items = periods.map { JSONValue.object(["relative_period": .number(Double($0))]) }
        return SettingsChange(frontend: [remindersKey: .array(items)])
    }

    // MARK: Choices

    /// The offered reminder periods: at the due time, then minutes, hours, days and a week before.
    public static let presetPeriods = [0, -300, -1_800, -3_600, -86_400, -172_800, -604_800]

    /// The presets plus any other period the account already holds (Vikunja-web allows any), closest to the due date first.
    public static func options(including held: [Int]) -> [Int] {
        Array(Set(presetPeriods + held)).sorted(by: >)
    }

    /// "At due time", "30 minutes before", "2 days before", "1 hour after".
    public static func title(forPeriod period: Int) -> String {
        guard period != 0 else { return "At due time" }
        let seconds = abs(period)
        let units: [(size: Int, name: String)] = [(604_800, "week"), (86_400, "day"), (3_600, "hour"), (60, "minute")]
        let unit = units.first { seconds % $0.size == 0 } ?? (size: 60, name: "minute")
        let count = max(seconds / unit.size, 1)
        return "\(count) \(unit.name)\(count == 1 ? "" : "s") \(period < 0 ? "before" : "after")"
    }

    // MARK: Device copy

    /// The account's values as last read, kept in UserDefaults so quick add (and the extensions) need no round trip.
    public static func current(in defaults: UserDefaults = .standard) -> QuickAddDefaults {
        QuickAddDefaults(
            dueTime: defaults.string(forKey: dueTimeDefaultsKey).flatMap { DefaultDueTime(text: $0) },
            reminderPeriods: defaults.array(forKey: remindersDefaultsKey) as? [Int] ?? []
        )
    }

    public func store(in defaults: UserDefaults = .standard) {
        let text = dueTime?.text ?? ""
        if defaults.string(forKey: Self.dueTimeDefaultsKey) != text { defaults.set(text, forKey: Self.dueTimeDefaultsKey) }
        if defaults.array(forKey: Self.remindersDefaultsKey) as? [Int] != reminderPeriods {
            defaults.set(reminderPeriods, forKey: Self.remindersDefaultsKey)
        }
    }

    // MARK: Migration

    /// What to upload once from the old device-local Mac reminder: its value as a period when the server holds no
    /// reminder list at all (an empty list the user saved counts as held), else nil. `legacySecondsBefore` is the old
    /// stored choice, negative for "none".
    public static func migratedReminders(frontend: JSONBody, legacySecondsBefore: Int?) -> [Int]? {
        guard let legacy = legacySecondsBefore, legacy >= 0, frontend[remindersKey] == nil else { return nil }
        return [-legacy]
    }
}
