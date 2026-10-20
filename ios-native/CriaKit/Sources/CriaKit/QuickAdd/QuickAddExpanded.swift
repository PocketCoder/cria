import Foundation

// The expanded quick-add syntax (Settings > Quick add > "Expanded quick-add syntax", off by default, kept in
// `frontend_settings.cria.expandedQuickAdd`). Todoist-style extras that Vikunja-web's Quick Add Magic does not read,
// parsed only when `parseQuickAdd(expanded: true)` and the magic itself is on:
//
// - `p1` to `p4` priorities. Todoist's p1 is its most urgent and p4 its plainest; Vikunja's scale is 1 Low, 2 Medium,
//   3 High, 4 Urgent, 5 Do now. So p1 is 4 (Urgent), p2 is 3 (High), p3 is 2 (Medium) and p4 is 1 (Low). "Do now" stays
//   `!5`. An `!` priority in the same line wins over a `p` word.
// - `every! day`, `every! 2 weeks`, `every week after completion`, `daily after done`: repeat from the day the task is
//   completed, not from its due date (`repeat_mode` 2). Vikunja counts a month as 30 days there, as it does for any
//   repeat in seconds.
// - `{friday}`, `{in 3 days}`: a deadline, stored as the end date. The braces must hold nothing but a date.
// - `9-10am`, `14:00-15:30`, `at 9-10am`: a time range. The date comes from the rest of the line (today when it has
//   none); the start is the due time and the start date, the end is the end date.
// - `for 1h`, `for 30m`, `for 1h30m`, `for 2 hours`: a duration after the due time. Only when the line gives the task a
//   time of day (an "at 3pm", a range or the account's default due time); otherwise the words stay in the title.
// Vikunja has no bucket for a task outside a view, so Todoist's `/bucket` is not read.

/// A time range cut from the text: minutes after midnight, and the tokens it made (their kind is set once the date is).
struct QuickAddTimeRange {
    let startMinute: Int
    let endMinute: Int
    let tokens: Range<Int>
}

/// Todoist's p1 to p4 as Vikunja priorities (4 to 1).
func quickAddPriority(fromWord digit: Int) -> Int { 5 - digit }

/// Cuts every `p1` to `p4` word and returns the priority of the first.
func quickAddCutPriorityWords(from work: inout QuickAddWorkingText) -> Int? {
    var cuts: [(range: NSRange, priority: Int)] = []
    for match in quickAddMatches(#"(^|\s)(p([1-4]))(?=$|[\s,.;:!?])"#, in: work.current) {
        guard let digit = Int(work.current.substring(with: match.range(at: 3))) else { continue }
        cuts.append((match.range(at: 2), quickAddPriority(fromWord: digit)))
    }
    for cut in cuts.reversed() { work.remove(cut.range, as: .priority(cut.priority)) }
    return cuts.first?.priority
}

// MARK: Repeat from completion

private let amountWords = "([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)"
private let completionRepeatPattern = "(^| )((?:(?:every|each)(!?) (?:" + amountWords + " )?(hours?|days?|weeks?|months?|years?)"
    + "|(annually|daily|hourly|monthly|weekly|yearly))( after (?:completion|completing|completed|done))?)($| )"

/// `every! 3 days` or `every 3 days after completion`: the first one, cut out, as a repeat from the completion date.
func quickAddCutCompletionRepeat(from work: inout QuickAddWorkingText) -> QuickAddRepeat? {
    let text = work.current
    for match in quickAddMatches(completionRepeatPattern, in: text) {
        func group(_ index: Int) -> String? {
            match.range(at: index).location == NSNotFound ? nil : text.substring(with: match.range(at: index)).lowercased()
        }
        guard group(3) == "!" || group(7) != nil, let repeats = completionRepeat(group) else { continue }
        work.remove(match.range(at: 2), as: .recurrence(repeatAfter: repeats.after, repeatMode: repeats.mode))
        return repeats
    }
    return nil
}

private func completionRepeat(_ group: (Int) -> String?) -> QuickAddRepeat? {
    var amount = 1
    var unit = group(5)
    if let keyword = group(6), let entry = keywordRepeats[keyword] {
        amount = entry.amount
        unit = entry.unit
    } else if let word = group(4) {
        guard let value = numberWords[word] ?? Int(word) else { return nil }
        amount = value
    }
    if let name = unit, name.hasSuffix("s") { unit = String(name.dropLast()) }
    guard let unit, let seconds = secondsPerUnit[unit], amount > 0 else { return nil }
    let (product, overflow) = amount.multipliedReportingOverflow(by: seconds)
    return overflow ? nil : QuickAddRepeat(after: product, mode: 2)
}

// MARK: Deadline

/// `{friday}`: the first brace pair that holds only a date, cut out. The date is all-day unless it names a time.
func quickAddCutDeadline(from work: inout QuickAddWorkingText, context: QuickAddDateContext) -> String? {
    let plain = QuickAddDateContext(now: context.now, calendar: context.calendar, defaultDueTime: nil, rules: context.rules)
    for match in quickAddMatches(#"\{([^{}]*)\}"#, in: work.current) {
        let inner = work.current.substring(with: match.range(at: 1))
        var scratch = QuickAddWorkingText(inner)
        guard let found = applyMagicDate(to: &scratch, context: plain),
              scratch.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
        let iso = namesATime(inner) ? found : DueDates.allDayISO(for: dayOf(found, context.calendar), calendar: context.calendar)
        work.remove(match.range, as: .deadline(iso: iso))
        return iso
    }
    return nil
}

private func namesATime(_ text: String) -> Bool {
    text.range(of: #"(?i)(?:\bat\b|@|\bhours?\b|\btonight\b)"#, options: .regularExpression) != nil
}

private func dayOf(_ iso: String, _ calendar: Calendar) -> Date {
    DueDates.calendarDate(iso, calendar: calendar) ?? Date()
}

// MARK: Time ranges

private let rangePattern = [
    #"(?<![\w:.-])((?:(?:at|@) )?(\d{1,2})(?::(\d{2}))?\s?(am|pm)?"#,
    #"\s?[-\x{2013}]\s?(\d{1,2})(?::(\d{2}))?\s?(am|pm)?)(?![\w:])"#
].joined()

/// `9-10am`, `9:30am-11`, `14:00-15:30`: cut the first valid range out. Without am or pm both ends need minutes
/// ("1-2" is not a time). A start with no am or pm takes the end's, or the other one when that would end before it begins.
func quickAddCutTimeRange(from work: inout QuickAddWorkingText) -> QuickAddTimeRange? {
    let text = work.current
    for match in quickAddMatches(rangePattern, in: text) {
        func number(_ index: Int) -> Int? {
            match.range(at: index).location == NSNotFound ? nil : Int(text.substring(with: match.range(at: index)))
        }
        func word(_ index: Int) -> String? {
            match.range(at: index).location == NSNotFound ? nil : text.substring(with: match.range(at: index)).lowercased()
        }
        guard let startHour = number(2), let endHour = number(5),
              let span = rangeMinutes(
                start: (startHour, number(3), word(4)), end: (endHour, number(6), word(7))
              ) else { continue }
        let before = work.tokenCount
        work.remove(match.range(at: 1), as: .text)
        return QuickAddTimeRange(startMinute: span.start, endMinute: span.end, tokens: before..<work.tokenCount)
    }
    return nil
}

private typealias ClockEnd = (hour: Int, minute: Int?, meridiem: String?)

private func rangeMinutes(start: ClockEnd, end: ClockEnd) -> (start: Int, end: Int)? {
    if start.meridiem == nil, end.meridiem == nil {
        guard start.minute != nil, end.minute != nil else { return nil }
        return orderedSpan(minutes(start.hour, start.minute, isPM: nil), minutes(end.hour, end.minute, isPM: nil))
    }
    guard (1...12).contains(end.hour), (1...12).contains(start.hour) else { return nil }
    let endIsPM = (end.meridiem ?? start.meridiem) == "pm"
    let endMinutes = minutes(end.hour, end.minute, isPM: endIsPM)
    if let given = start.meridiem {
        return orderedSpan(minutes(start.hour, start.minute, isPM: given == "pm"), endMinutes)
    }
    // "9-10am", "11-1pm": the start shares the end's am or pm unless that puts it at or after the end.
    let shared = minutes(start.hour, start.minute, isPM: endIsPM)
    if let span = orderedSpan(shared, endMinutes) { return span }
    return orderedSpan(minutes(start.hour, start.minute, isPM: !endIsPM), endMinutes)
}

/// Minutes after midnight; `pm` nil means a 24-hour clock, else the hour is on a 12-hour clock.
private func minutes(_ hour: Int, _ minute: Int?, isPM: Bool?) -> Int? {
    guard (minute ?? 0) < 60 else { return nil }
    guard let isPM else { return hour < 24 ? hour * 60 + (minute ?? 0) : nil }
    return (hour % 12 + (isPM ? 12 : 0)) * 60 + (minute ?? 0)
}

private func orderedSpan(_ start: Int?, _ end: Int?) -> (start: Int, end: Int)? {
    guard let start, let end, end > start else { return nil }
    return (start, end)
}

/// Puts the range on the line's date (today when it has none): the due time, start date and end date.
func quickAddApplyTimeRange(
    _ range: QuickAddTimeRange, work: inout QuickAddWorkingText, result: inout QuickAddResult, context: QuickAddDateContext
) {
    let calendar = context.calendar
    let day = result.dueDate.map { dayOf($0, calendar) } ?? context.today
    guard let start = calendar.date(bySettingHour: range.startMinute / 60, minute: range.startMinute % 60, second: 0, of: day),
          let end = calendar.date(bySettingHour: range.endMinute / 60, minute: range.endMinute % 60, second: 0, of: day) else {
        return
    }
    let startISO = DueDates.timedISO(start)
    let endISO = DueDates.timedISO(end)
    result.dueDate = startISO
    result.startDate = startISO
    if result.endDate == nil { result.endDate = endISO }
    work.retag(range.tokens, as: .duration(startISO: startISO, endISO: endISO))
}

// MARK: Durations

private let durationPattern = [
    #"(^| )(for (\d+(?:\.\d+)?) ?(hours?|hrs?|h|minutes?|mins?|m)"#,
    #"(?: ?(\d+) ?(minutes?|mins?|m))?)(?![A-Za-z0-9])"#
].joined()
private let longestDuration = 7 * 24 * 60

/// `for 1h30m` after a due time: the start date is the due time and the end date that much later.
func quickAddApplyDuration(work: inout QuickAddWorkingText, result: inout QuickAddResult) {
    guard result.startDate == nil, let due = result.dueDate, DueDates.hasTimeOfDay(due), let start = DueDates.parse(due) else { return }
    let source = work.current
    for match in quickAddMatches(durationPattern, in: source) {
        func text(_ index: Int) -> String? {
            match.range(at: index).location == NSNotFound ? nil : source.substring(with: match.range(at: index)).lowercased()
        }
        guard let first = text(3).flatMap({ Double($0) }), let unit = text(4) else { continue }
        let inHours = unit.hasPrefix("h")
        var total = first * (inHours ? 60 : 1)
        if let extra = text(5).flatMap({ Double($0) }) {
            guard inHours else { continue }
            total += extra
        }
        let minutes = Int(total.rounded())
        guard minutes > 0, minutes <= longestDuration else { continue }
        let endISO = DueDates.timedISO(start.addingTimeInterval(TimeInterval(minutes * 60)))
        work.remove(match.range(at: 2), as: .duration(startISO: due, endISO: endISO))
        result.startDate = due
        if result.endDate == nil { result.endDate = endISO }
        return
    }
}
