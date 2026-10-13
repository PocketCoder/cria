import Foundation
@testable import CriaKit

/// A UTC calendar so date assertions do not depend on the machine's timezone.
let utcCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
    calendar.locale = Locale(identifier: "en_GB")
    return calendar
}()

/// Wed 2026-05-27 10:00 UTC, as in the TypeScript tests.
let quickAddNow = DueDates.parse("2026-05-27T10:00:00Z") ?? Date()

func parse(_ input: String, mode: QuickAddMagicMode = .default) -> QuickAddResult {
    parseQuickAdd(input, now: quickAddNow, mode: mode, calendar: utcCalendar)
}

func parseTask(_ input: String, mode: QuickAddMagicMode = .default) -> QuickAddResult {
    parseQuickAddTask(input, now: quickAddNow, mode: mode, calendar: utcCalendar)
}

/// Everything a literal title must leave empty.
func nothingParsed(_ result: QuickAddResult) -> Bool {
    result.dueDate == nil && result.priority == nil && result.labelTitles.isEmpty && result.assigneeUsernames.isEmpty
        && result.projectTitle == nil && result.repeatAfter == nil && result.repeatMode == nil
}

func utcParts(_ iso: String?) -> DateComponents? {
    iso.flatMap(DueDates.parse).map {
        utcCalendar.dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: $0)
    }
}
