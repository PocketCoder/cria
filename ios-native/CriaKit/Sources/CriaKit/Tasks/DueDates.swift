import Foundation

/// Due-date rules from `src/lib/dateFormat.ts`. All-day values are stored at exactly UTC midnight and keep the
/// day that was picked whatever the timezone; timed values use the local day.
public enum DueDates {
    /// Shared formatters: `ISO8601DateFormatter` is thread-safe, and building one per call made sorting by due date
    /// allocate two per comparison.
    private nonisolated(unsafe) static let plainFormatter = ISO8601DateFormatter()
    private nonisolated(unsafe) static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    public static func parse(_ iso: String) -> Date? {
        plainFormatter.date(from: iso) ?? fractionalFormatter.date(from: iso)
    }

    /// True when the value carries a real time of day (anything but exactly UTC midnight).
    public static func hasTimeOfDay(_ iso: String?) -> Bool {
        guard let iso, let date = parse(iso) else { return false }
        return Int((date.timeIntervalSince1970 * 1000).rounded()) % 86_400_000 != 0
    }

    /// The local calendar day (local midnight) a due date falls on.
    public static func calendarDate(_ iso: String, calendar: Calendar = .current) -> Date? {
        guard let date = parse(iso) else { return nil }
        if hasTimeOfDay(iso) { return calendar.startOfDay(for: date) }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let parts = utc.dateComponents([.year, .month, .day], from: date)
        return calendar.date(from: parts)
    }

    /// `yyyy-MM-dd` key for day bucketing (Upcoming agenda).
    public static func dayKey(_ iso: String, calendar: Calendar = .current) -> String? {
        guard let day = calendarDate(iso, calendar: calendar) else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: day)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Overdue: a timed value is past when its instant is; an all-day value when its day is before today.
    public static func isOverdue(_ iso: String, now: Date, calendar: Calendar = .current) -> Bool {
        guard let date = parse(iso) else { return false }
        if hasTimeOfDay(iso) { return date < now }
        guard let day = calendarDate(iso, calendar: calendar) else { return false }
        return day < calendar.startOfDay(for: now)
    }

    /// Compact row label: Today, Tomorrow, Yesterday, a weekday within the coming week, else "d MMM",
    /// with the time appended when one was set.
    /// Far dates and times follow `display` (Settings > General); "Today" and the weekday names stay words.
    public static func label(_ iso: String, now: Date, calendar: Calendar = .current, display: DateDisplay = .standard) -> String {
        guard let day = calendarDate(iso, calendar: calendar), let date = parse(iso) else { return "" }
        let today = calendar.startOfDay(for: now)
        let offset = calendar.dateComponents([.day], from: today, to: day).day ?? 0
        let locale = calendar.locale ?? .current
        var text: String
        switch offset {
        case 0: text = "Today"
        case 1: text = "Tomorrow"
        case -1: text = "Yesterday"
        case 2...6: text = format(day, "EEEE", calendar: calendar, locale: locale)
        default: text = format(day, display.datePattern, calendar: calendar, locale: locale)
        }
        if hasTimeOfDay(iso) {
            text += " " + format(date, display.timePattern, calendar: calendar, locale: locale)
        }
        return text
    }

    /// Full date and time of an instant (reminders, timestamps): "2026-10-11 14:30", "11 Oct 2026 2:30 PM".
    public static func fullLabel(_ date: Date, calendar: Calendar = .current, display: DateDisplay = .standard) -> String {
        let locale = calendar.locale ?? .current
        let day = display.dateFormat == .automatic ? "d MMM yyyy" : display.datePattern
        return format(date, day, calendar: calendar, locale: locale) + " " + format(date, display.timePattern, calendar: calendar, locale: locale)
    }

    // MARK: Writing

    /// All-day value for the calendar day `date` falls on locally: UTC midnight of that day.
    public static func allDayISO(for date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let midnight = utc.date(from: parts) ?? date
        return plainFormatter.string(from: midnight)
    }

    /// Timed value, written to the second. An instant that lands on UTC midnight (to the second, since the fraction is
    /// dropped) would read back as all-day, so it moves one second.
    public static func timedISO(_ date: Date) -> String {
        let seconds = Int(date.timeIntervalSince1970.rounded(.down))
        let safe = seconds % 86_400 == 0 ? seconds + 1 : seconds
        return plainFormatter.string(from: Date(timeIntervalSince1970: TimeInterval(safe)))
    }

    /// The `Date` a picker should show for a stored value: local midnight of the day for all-day values,
    /// the instant for timed ones.
    public static func pickerDate(_ iso: String, calendar: Calendar = .current) -> Date? {
        hasTimeOfDay(iso) ? parse(iso) : calendarDate(iso, calendar: calendar)
    }

    private static func format(_ date: Date, _ pattern: String, calendar: Calendar, locale: Locale) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}

/// How dates and times are written, from the Settings > General choices.
public struct DateDisplay: Equatable, Sendable {
    public var dateFormat: DateFormatPreference
    public var timeFormat: TimeFormatPreference

    public static let standard = DateDisplay()

    public init(dateFormat: DateFormatPreference = .automatic, timeFormat: TimeFormatPreference = .h24) {
        self.dateFormat = dateFormat
        self.timeFormat = timeFormat
    }

    /// DateFormatter pattern for a calendar day.
    var datePattern: String {
        switch dateFormat {
        case .automatic: "d MMM"
        case .iso: "yyyy-MM-dd"
        case .us: "MM/dd/yyyy"
        case .european: "dd/MM/yyyy"
        }
    }

    var timePattern: String {
        timeFormat == .h12 ? "h:mm a" : "HH:mm"
    }
}
