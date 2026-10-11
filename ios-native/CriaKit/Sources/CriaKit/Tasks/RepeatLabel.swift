import Foundation

/// Recurrence helpers. Ported from `src/lib/repeatLabel.ts`.
public enum RepeatLabel {
    private static let hour = 3600
    private static let day = 86400
    private static let week = 604_800
    private static let year = 31_536_000

    /// Monthly mode (`repeatMode` 1) ignores `repeatAfter` on the server, so check both.
    public static func isRepeating(repeatAfter: Int, repeatMode: Int) -> Bool {
        repeatMode == 1 || repeatAfter > 0
    }

    /// Human label for a task's recurrence: monthly mode, or an interval in seconds. Empty when it does not repeat.
    public static func label(repeatAfter: Int, repeatMode: Int) -> String {
        if repeatMode == 1 { return "Monthly" }
        guard repeatAfter > 0 else { return "" }
        let units: [(seconds: Int, single: String, plural: String)] = [
            (year, "Yearly", "years"), (week, "Weekly", "weeks"), (day, "Daily", "days"), (hour, "Hourly", "hours")
        ]
        for unit in units where repeatAfter >= unit.seconds && repeatAfter % unit.seconds == 0 {
            let count = repeatAfter / unit.seconds
            return count == 1 ? unit.single : "Every \(count) \(unit.plural)"
        }
        return "Every \(repeatAfter)s"
    }
}
