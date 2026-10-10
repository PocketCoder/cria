import Foundation

/// Date helpers shared by the query parsers. Strings match JavaScript's `Date.toISOString()`
/// (UTC, millisecond precision), the format stored in Vikunja due dates.
enum QueryDates {
    static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone.gmt
        return calendar
    }()

    /// `Date.toISOString()` equivalent.
    static func isoString(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }

    /// Midnight UTC of the local calendar day of `date`, shifted by `days`.
    static func utcMidnight(of date: Date, plusDays days: Int = 0, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        guard let base = utcCalendar.date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day)),
              let shifted = utcCalendar.date(byAdding: .day, value: days, to: base) else {
            return isoString(date)
        }
        return isoString(shifted)
    }

    /// 23:59:59.999 UTC of the local calendar day of `date`, shifted by `days`.
    static func utcEndOfDay(of date: Date, plusDays days: Int = 0, calendar: Calendar) -> String {
        let midnight = utcMidnight(of: date, plusDays: days, calendar: calendar)
        return String(midnight.prefix(10)) + "T23:59:59.999Z"
    }

    /// End of the week (23:59:59.999 UTC) for the local day of `date`. `weekStartsOn`: 0 is Sunday, 1 is Monday.
    static func utcEndOfWeek(of date: Date, weekStartsOn: Int, calendar: Calendar) -> String {
        let dayOfWeek = calendar.component(.weekday, from: date) - 1
        let diff = (6 - dayOfWeek + weekStartsOn) % 7
        return utcEndOfDay(of: date, plusDays: diff, calendar: calendar)
    }
}
