import Foundation

/// Due-date rules from `src/lib/dateFormat.ts`. All-day values are stored at exactly UTC midnight and keep the
/// day that was picked whatever the timezone; timed values use the local day.
public enum DueDates {
    public static func parse(_ iso: String) -> Date? {
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: iso) { return date }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: iso)
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
    public static func label(_ iso: String, now: Date, calendar: Calendar = .current) -> String {
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
        default: text = format(day, "d MMM", calendar: calendar, locale: locale)
        }
        if hasTimeOfDay(iso) {
            text += " " + format(date, "HH:mm", calendar: calendar, locale: locale)
        }
        return text
    }

    // MARK: Writing

    /// All-day value for the calendar day `date` falls on locally: UTC midnight of that day.
    public static func allDayISO(for date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let midnight = utc.date(from: parts) ?? date
        return ISO8601DateFormatter().string(from: midnight)
    }

    /// Timed value. An instant that lands exactly on UTC midnight would read back as all-day, so it moves one second.
    public static func timedISO(_ date: Date) -> String {
        let millis = Int((date.timeIntervalSince1970 * 1000).rounded())
        let safe = millis % 86_400_000 == 0 ? date.addingTimeInterval(1) : date
        return ISO8601DateFormatter().string(from: safe)
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
