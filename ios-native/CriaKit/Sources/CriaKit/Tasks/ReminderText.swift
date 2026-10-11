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
}
