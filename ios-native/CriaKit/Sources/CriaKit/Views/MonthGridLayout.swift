import Foundation

/// The days of a month grid, for Upcoming's month view.
public enum MonthGridLayout {
    /// Whole weeks (in the calendar's first weekday) from the week holding the 1st to the week holding the last day,
    /// so a month is four to six rows of seven. Days outside the month are included to fill the first and last week.
    public static func days(forMonthContaining date: Date, calendar: Calendar) -> [Date] {
        guard let month = calendar.dateInterval(of: .month, for: date),
              let firstWeek = calendar.dateInterval(of: .weekOfYear, for: month.start),
              let lastDay = calendar.date(byAdding: .day, value: -1, to: month.end),
              let lastWeek = calendar.dateInterval(of: .weekOfYear, for: lastDay) else { return [] }
        var days: [Date] = []
        var day = firstWeek.start
        while day < lastWeek.end && days.count < 42 {
            days.append(day)
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return days
    }
}
