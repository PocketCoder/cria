import Foundation

public enum ReminderText {
    /// "1 day", "2 hours", "90 min": the largest whole unit that divides the span evenly.
    public static func span(seconds: Int) -> String {
        let total = abs(seconds)
        for (unit, length) in [("day", 86_400), ("hour", 3_600)] where total >= length && total % length == 0 {
            let count = total / length
            return "\(count) \(unit)\(count == 1 ? "" : "s")"
        }
        return "\(total / 60) min"
    }

    /// "at due date", "1 day before due date", "30 min after start date".
    public static func relative(period: Int, anchor: String) -> String {
        let name = anchor.replacingOccurrences(of: "_", with: " ")
        if period == 0 { return "at \(name)" }
        return "\(span(seconds: period)) \(period < 0 ? "before" : "after") \(name)"
    }

    /// "1 day before due date at 09:00": a reminder that fires on an earlier day at its own time of day, as day-based
    /// reminders do. Nil for any other, which `relative` describes.
    public static func dayBased(
        period: Int, anchor: String, fires: Date, calendar: Calendar = .cria, display: DateDisplay = .standard
    ) -> String? {
        guard period < 0, period % 86_400 != 0 else { return nil }
        let base = fires.addingTimeInterval(TimeInterval(-period))
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: fires), to: calendar.startOfDay(for: base)).day ?? 0
        guard days >= 1 else { return nil }
        let name = anchor.replacingOccurrences(of: "_", with: " ")
        return "\(days) day\(days == 1 ? "" : "s") before \(name) at \(DueDates.timeLabel(fires, calendar: calendar, display: display))"
    }
}
