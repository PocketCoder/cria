import Foundation

// Quick Add Magic dates, ported from Vikunja-web (`frontend/src/modules/quickAddMagic/dateParser.ts`). The phrase
// list, the order the phrases are tried in and the odd corners (a day-of-month rolls forward, "tonight" is 21:00, a
// bare "at 5pm" is today) follow upstream. Where Cria differs on purpose:
//
// - A date typed without a time is all-day (UTC midnight, see `DueDates`) unless the account has a default due
//   time, which `parseQuickAdd` applies afterwards. Vikunja-web falls back to the nearest hour or to "now" there.
// - Only the matched phrase is cut from the title (upstream strips every copy of it, even inside other words).
// - A year-less date that is today stays today (upstream compares with the current time and jumps a year on).
// - "in N days" needs "in" to start a word ("within 3 days" is not a date) and a month name needs to end one
//   ("2 marbles" is not 2 March).
// - "next monday" on a Monday is a week on (upstream's arithmetic gives today).
// - A year-first date (2026-13-01) is never read with its month and day swapped.
// - A time outside 00:00 to 23:59 is left in the title; upstream wraps it into the next day.
// - "this weekend" and "next week" follow Settings > Customise > Dates (the same days as upstream by default).

private let monthsGroup = "(?:january|february|march|april|june|july|august|september|october|november|december"
    + "|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
private let weekdayNames = "(?:monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)"
private let timePattern = #" (at|@) ([0-9][0-9]?(:[0-9][0-9])?( ?(?:a|p)m)?)"#
private let weekdayPattern = "(^| )(next )?(" + weekdayNames + ")($| )"
private let ordinalPattern = "(^| )((?:[1-2][0-9])|(?:3[01])|(?:0?[1-9]))(st|nd|rd|th|\\.)(?=$| at | @ | " + monthsGroup + ")"
private let inPattern = #"\b(in [0-9]+ (hours?|days?|weeks?|months?))"#
private let monthNamePattern = "(^| )(" + monthsGroup + " [0-9][0-9]?\\b|[0-9][0-9]? " + monthsGroup + "\\b)"

/// Everything the date steps need besides the text.
struct QuickAddDateContext {
    let now: Date
    let calendar: Calendar
    let defaultDueTime: DefaultDueTime?
    let rules: CriaRules

    var today: Date { calendar.startOfDay(for: now) }

    func day(offset: Int) -> Date {
        calendar.date(byAdding: .day, value: offset, to: today) ?? today
    }
}

/// A date and whether it carries a time (an instant) or stands for the whole day.
private struct FoundDate {
    var date: Date
    var timed = false
}

/// Finds the date in `work`, cuts its words (and a time after them) out, and returns it as an ISO value (an all-day
/// value takes the default due time). Nil when the text holds no date (and the text is left alone). The cut pieces
/// are tokens of kind `.date`.
func applyMagicDate(to work: inout QuickAddWorkingText, context: QuickAddDateContext) -> String? {
    let before = work.tokenCount
    guard let found = magicDate(&work, context) else { return nil }
    let iso = context.defaultDueTime?.applying(to: found, calendar: context.calendar) ?? found
    work.retag(from: before, as: .date(iso: iso))
    return iso
}

private func magicDate(_ work: inout QuickAddWorkingText, _ context: QuickAddDateContext) -> String? {
    if let keyword = keywordDate(work.current, context) {
        return finish(&work, found: keyword.found, phrases: [keyword.range], context: context)
    }
    if let weekday = weekdayDate(work.current, context) {
        return finish(&work, found: weekday.found, phrases: [weekday.range], context: context)
    }
    if let ordinal = ordinalDate(work.current, context) {
        return finish(&work, found: ordinal.found, phrases: ordinal.ranges, context: context)
    }
    if let relative = relativeDate(work.current, context) {
        return finish(&work, found: relative.found, phrases: [relative.range], context: context)
    }
    if let calendarDate = calendarDate(work.current, context) {
        return finish(&work, found: calendarDate.found, phrases: [calendarDate.range], context: context)
    }
    return timeOnly(&work, context)
}

// MARK: Time and assembly

private struct TimeMatch {
    let range: NSRange
    let hour: Int
    let minute: Int
}

/// " at 3pm", " @ 15:00", " at 3:12 am": the first time after "at" or "@" (it needs the space before it).
private func findTime(_ text: NSString) -> TimeMatch? {
    guard let match = quickAddFirstMatch(timePattern, in: text) else { return nil }
    let clock = text.substring(with: match.range(at: 2)).lowercased()
    let lead = clock.prefix { $0.isNumber }
    guard var hour = Int(lead) else { return nil }
    var minute = 0
    if match.range(at: 3).location != NSNotFound {
        minute = Int(text.substring(with: match.range(at: 3)).dropFirst()) ?? 0
    }
    if clock.hasSuffix("pm") {
        if hour != 12 { hour += 12 }
    } else if clock.hasSuffix("am"), hour == 12 {
        hour = 0
    }
    guard hour < 24, minute < 60 else { return nil }
    return TimeMatch(range: match.range, hour: hour, minute: minute)
}

/// Cuts the date words, reads a time after them ("at 15:00" sets it on the day) and builds the ISO value.
private func finish(
    _ work: inout QuickAddWorkingText, found: FoundDate, phrases: [NSRange], context: QuickAddDateContext
) -> String {
    work.remove(phrases, as: .text)
    let calendar = context.calendar
    if let time = findTime(work.current) {
        work.remove(time.range, as: .text)
        let day = calendar.startOfDay(for: found.date)
        let set = calendar.date(bySettingHour: time.hour, minute: time.minute, second: 0, of: day) ?? found.date
        return DueDates.timedISO(set)
    }
    return found.timed ? DueDates.timedISO(found.date) : DueDates.allDayISO(for: found.date, calendar: calendar)
}

/// "buy milk at 3pm": a time with no date means today at that time (even when it has passed, as upstream).
private func timeOnly(_ work: inout QuickAddWorkingText, _ context: QuickAddDateContext) -> String? {
    guard let time = findTime(work.current),
          let set = context.calendar.date(bySettingHour: time.hour, minute: time.minute, second: 0, of: context.today),
          set != context.now else { return nil }
    work.remove(time.range, as: .text)
    return DueDates.timedISO(set)
}

// MARK: Keywords

/// The phrase `(^| )phrase` in `text`, as the range of the phrase alone.
private func phraseRange(_ phrase: String, in text: NSString) -> NSRange? {
    let pattern = "(^| )(" + NSRegularExpression.escapedPattern(for: phrase) + ")"
    return quickAddFirstMatch(pattern, in: text).map { $0.range(at: 2) }
}

private func keywordDate(_ text: NSString, _ context: QuickAddDateContext) -> (found: FoundDate, range: NSRange)? {
    let weekday = context.calendar.component(.weekday, from: context.now) - 1
    let laterThisWeek = [5, 6, 0].contains(weekday) ? 0 : 2
    let rules = context.rules
    let weekend = rules.weekendWeekday == 7
        ? (6 - weekday) % 6 : rules.weekendOffset(from: context.today, calendar: context.calendar)
    let nextWeek = rules.nextWeekOffset(from: context.today, calendar: context.calendar)
    // Upstream's order matters: "later next week" must be tried before "next week".
    let phrases: [(String, () -> FoundDate?)] = [
        ("today", { FoundDate(date: context.today) }),
        ("tonight", { tonight(context) }),
        ("tomorrow", { FoundDate(date: context.day(offset: 1)) }),
        ("next monday", { FoundDate(date: context.day(offset: weekday == 1 ? 7 : (8 - weekday) % 7)) }),
        ("this weekend", { FoundDate(date: context.day(offset: weekend)) }),
        ("later this week", { FoundDate(date: context.day(offset: laterThisWeek)) }),
        ("later next week", { FoundDate(date: context.day(offset: laterThisWeek + 7)) }),
        ("next week", { FoundDate(date: context.day(offset: nextWeek)) }),
        ("next month", { nextMonth(context) }),
        ("end of month", { endOfMonth(context) })
    ]
    for (phrase, make) in phrases {
        if let range = phraseRange(phrase, in: text), let found = make() { return (found, range) }
    }
    return nil
}

/// 21:00 today (with the minutes of the default due time, as upstream's `setHours(21)` keeps them).
private func tonight(_ context: QuickAddDateContext) -> FoundDate? {
    let minute = context.defaultDueTime?.minute ?? 0
    guard let evening = context.calendar.date(bySettingHour: 21, minute: minute, second: 0, of: context.today) else { return nil }
    return FoundDate(date: evening, timed: true)
}

private func nextMonth(_ context: QuickAddDateContext) -> FoundDate? {
    var parts = context.calendar.dateComponents([.year, .month], from: context.now)
    parts.day = 1
    guard let first = context.calendar.date(from: parts),
          let next = context.calendar.date(byAdding: .month, value: 1, to: first) else { return nil }
    return FoundDate(date: next)
}

/// The last day of the current month.
private func endOfMonth(_ context: QuickAddDateContext) -> FoundDate? {
    guard let next = nextMonth(context)?.date, let last = context.calendar.date(byAdding: .day, value: -1, to: next) else { return nil }
    return FoundDate(date: last)
}

// MARK: Weekdays

/// "friday", "next fri": the next such day, today included. "next" changes nothing, as upstream.
private func weekdayDate(_ text: NSString, _ context: QuickAddDateContext) -> (found: FoundDate, range: NSRange)? {
    guard let match = quickAddFirstMatch(weekdayPattern, in: text) else { return nil }
    let name = text.substring(with: match.range(at: 3)).lowercased()
    let days = ["sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6]
    guard let target = days[String(name.prefix(3))] else { return nil }
    let current = context.calendar.component(.weekday, from: context.now) - 1
    let start = match.range(at: 2).location != NSNotFound ? match.range(at: 2).location : match.range(at: 3).location
    let range = NSRange(location: start, length: match.range(at: 3).location + match.range(at: 3).length - start)
    return (FoundDate(date: context.day(offset: (target + 7 - current) % 7)), range)
}

// MARK: Day of the month

/// "17th", "2nd march": the next such day of a month (this month if it has not passed). Only with an ordinal and
/// then the end, "at", "@" or a month, so "2nd floor" stays text.
private func ordinalDate(_ text: NSString, _ context: QuickAddDateContext) -> (found: FoundDate, ranges: [NSRange])? {
    guard let match = quickAddFirstMatch(ordinalPattern, in: text),
          let day = Int(text.substring(with: match.range(at: 2))) else { return nil }
    let calendar = context.calendar
    guard var date = calendar.jsSetDate(context.now, day) else { return nil }
    var guardCount = 0
    while calendar.startOfDay(for: date) < context.today, guardCount < 24, let later = calendar.jsAddMonths(date, 1) {
        date = later
        guardCount += 1
    }
    if calendar.component(.day, from: date) != day, let fixed = calendar.jsSetDate(date, day) { date = fixed }
    let start = match.range(at: 2).location
    var ranges = [NSRange(location: start, length: match.range(at: 3).location + match.range(at: 3).length - start)]
    if let month = quickAddFirstMatch("\\b(" + monthsGroup + ")\\b", in: text) {
        let target = monthNumber(text.substring(with: month.range(at: 1))) - 1
        let current = calendar.component(.month, from: date) - 1
        if let moved = calendar.jsAddMonths(date, target - current) { date = moved }
        ranges.append(month.range(at: 1))
    }
    return (FoundDate(date: calendar.startOfDay(for: date)), ranges)
}

private func monthNumber(_ word: String) -> Int {
    let names = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12]
    return names[String(word.lowercased().prefix(3))] ?? 1
}

// MARK: In N units

/// "in 3 hours", "in 2 days", "in 1 month": that far from now, keeping the time of day.
private func relativeDate(_ text: NSString, _ context: QuickAddDateContext) -> (found: FoundDate, range: NSRange)? {
    guard let match = quickAddFirstMatch(inPattern, in: text) else { return nil }
    let words = text.substring(with: match.range(at: 1)).lowercased().split(separator: " ").map(String.init)
    guard words.count == 3, let amount = Int(words[1]), amount <= 100_000 else { return nil }
    let calendar = context.calendar
    let moved: Date?
    switch words[2].prefix(3) {
    case "hou": moved = calendar.date(byAdding: .hour, value: amount, to: context.now)
    case "day": moved = calendar.date(byAdding: .day, value: amount, to: context.now)
    case "wee": moved = calendar.date(byAdding: .day, value: amount * 7, to: context.now)
    default: moved = calendar.jsAddMonths(context.now, amount)
    }
    guard let date = moved else { return nil }
    return (FoundDate(date: date, timed: true), match.range(at: 1))
}

// MARK: Calendar dates

/// A numeric date (06/26/2021, 27/01, 2021-06-26, 26.06.2021) or "jan 27" / "27 jan".
private func calendarDate(_ text: NSString, _ context: QuickAddDateContext) -> (found: FoundDate, range: NSRange)? {
    if let numeric = numericDate(text, context) { return numeric }
    guard let match = quickAddFirstMatch(monthNamePattern, in: text) else { return nil }
    let phrase = match.range(at: 2)
    let words = text.substring(with: phrase).split(separator: " ").map(String.init)
    guard words.count == 2 else { return nil }
    let monthWord = words.first { Int($0) == nil } ?? ""
    let dayWord = words.first { Int($0) != nil } ?? ""
    guard let day = Int(dayWord),
          let date = rolledForward(month: monthNumber(monthWord), day: day, year: nil, context) else { return nil }
    return (FoundDate(date: date), phrase)
}

/// Group numbers of the month, day and year in each pattern. Where the order is ambiguous (06/26, 26.06) the day and
/// month swap when the first reading is no date; a year-first date never does.
private let numericPatterns: [(pattern: String, order: (month: Int, day: Int, year: Int), swaps: Bool)] = [
    (#"(^| )((\d\d?)/(\d\d?)(/(\d\d(?:\d\d)?))?)($| )"#, (3, 4, 6), true),
    (#"(^| )((\d\d\d\d?)/(\d\d?)/(\d\d))($| )"#, (4, 5, 3), false),
    (#"(^| )((\d\d\d\d?)-(\d\d?)-(\d\d))($| )"#, (4, 5, 3), false),
    (#"(^| )((\d\d?)\.(\d\d?)(\.(\d\d(?:\d\d)?))?)($| )"#, (4, 3, 6), true)
]

private func numericDate(_ text: NSString, _ context: QuickAddDateContext) -> (found: FoundDate, range: NSRange)? {
    for entry in numericPatterns {
        guard let match = boundaryMatch(entry.pattern, in: text) else { continue }
        func number(_ group: Int) -> Int? {
            match.range(at: group).location == NSNotFound ? nil : Int(text.substring(with: match.range(at: group)))
        }
        let yearText = match.range(at: entry.order.year).location == NSNotFound
            ? nil : text.substring(with: match.range(at: entry.order.year))
        let year = yearText.flatMap { fullYear($0) }
        if yearText != nil, year == nil { continue }
        guard let first = number(entry.order.month), let second = number(entry.order.day) else { continue }
        var date = rolledForward(month: first, day: second, year: year, context)
        if date == nil, entry.swaps { date = rolledForward(month: second, day: first, year: year, context) }
        if let date { return (FoundDate(date: date), match.range(at: 2)) }
    }
    return nil
}

/// A two-digit year is 20xx up to 49, 19xx from 50 (as the JavaScript date parser reads it); three digits are not a year.
private func fullYear(_ text: String) -> Int? {
    guard let value = Int(text) else { return nil }
    switch text.count {
    case 4: return value
    case 2: return value < 50 ? 2000 + value : 1900 + value
    default: return nil
    }
}

/// The day, or nil for a day that does not exist. With no year it is this year's, or next year's once it has passed.
private func rolledForward(month: Int, day: Int, year: Int?, _ context: QuickAddDateContext) -> Date? {
    let calendar = context.calendar
    let thisYear = calendar.component(.year, from: context.now)
    guard var date = realDate(year: year ?? thisYear, month: month, day: day, calendar: calendar) else { return nil }
    if year == nil, date < context.today, let next = realDate(year: thisYear + 1, month: month, day: day, calendar: calendar) {
        date = next
    }
    return date
}

private func realDate(year: Int, month: Int, day: Int, calendar: Calendar) -> Date? {
    guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
          calendar.component(.month, from: date) == month, calendar.component(.day, from: date) == day else { return nil }
    return date
}

/// The first match of a numeric date that sits at an edge of the text or is followed by "at" or "@", and is not part
/// of a range ("31.12.2026 - 01.01.2027"). A date in the middle of a title ("The 9/11 Report") stays text.
private func boundaryMatch(_ pattern: String, in text: NSString) -> NSTextCheckingResult? {
    for match in quickAddMatches(pattern, in: text) {
        let end = match.range.location + match.range.length
        let after = text.substring(from: end)
        let before = text.substring(to: match.range.location)
        if quickAddFirstMatch(#"^[-–—] ?[0-9]+[./-][0-9]"#, in: NSString(string: after)) != nil { continue }
        if quickAddFirstMatch(#"[0-9][./-][0-9]+\.? [-–—]$"#, in: NSString(string: before)) != nil { continue }
        if match.range.location == 0 || end >= text.length { return match }
        if after.lowercased().hasPrefix("at ") || after.hasPrefix("@ ") { return match }
    }
    return nil
}

// MARK: JavaScript date arithmetic

extension Calendar {
    /// `Date.setDate`: a day past the end of the month rolls into the next one.
    func jsSetDate(_ date: Date, _ day: Int) -> Date? {
        var parts = dateComponents([.year, .month, .hour, .minute, .second], from: date)
        parts.day = 1
        guard let first = self.date(from: parts) else { return nil }
        return self.date(byAdding: .day, value: day - 1, to: first)
    }

    /// `Date.setMonth(getMonth() + delta)`: the same day number, rolling into the next month when the target is shorter.
    func jsAddMonths(_ date: Date, _ delta: Int) -> Date? {
        let parts = dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
        let index = year * 12 + (month - 1) + delta
        let targetYear = Int((Double(index) / 12).rounded(.down))
        var target = DateComponents()
        target.year = targetYear
        target.month = index - targetYear * 12 + 1
        target.day = 1
        target.hour = parts.hour
        target.minute = parts.minute
        target.second = parts.second
        guard let first = self.date(from: target) else { return nil }
        return self.date(byAdding: .day, value: day - 1, to: first)
    }
}
