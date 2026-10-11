import Foundation

/// A date found in quick-add text. UTF-16 offsets, to line up with `NSString` and the preview tokens.
struct QuickAddDateMatch: Equatable {
    let start: Int
    let end: Int
    let text: String
    let iso: String
}

private let weekdayWord = "(?:monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)"
private let monthWord = "(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug"
    + "|september|sept|sep|october|oct|november|nov|december|dec)"
private let ordinal = "(?:st|nd|rd|th)?"

/// The Swift stand-in for chrono-node: a small deterministic set of phrases, resolved against `now`.
/// Supported: today, tonight, tomorrow, tmrw, yesterday; weekdays with optional this, next or on; next week;
/// in N minutes, hours, days, weeks, months or years; yyyy-mm-dd; "May 30th", "30 May 2026"; and a time of day
/// ("at 5pm", "17:30", "5pm") after a date or on its own.
private let datePattern = [
    #"\b(?:"#,
    #"(?:(?:next|this|on)\s+)?"#, weekdayWord,
    #"|next\s+week|today|tonight|tomorrow|tmrw|yesterday"#,
    #"|in\s+\d+\s+(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)"#,
    #"|\d{4}-\d{2}-\d{2}"#,
    "|", monthWord, #"\.?\s+\d{1,2}"#, ordinal, #"(?:,?\s+\d{4})?"#,
    #"|\d{1,2}"#, ordinal, #"\s+(?:of\s+)?"#, monthWord, #"(?:,?\s+\d{4})?"#,
    #")\b"#
].joined()

private let standaloneTimePattern =
    #"(?<![\w:])(?:(?:at|@)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b"#
private let trailingTimePattern = #"^\s+(?:(at|@)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\w:])"#

private struct TimeOfDay {
    let hour: Int
    let minute: Int
}

private enum ResolvedDate {
    case day(Date)
    case instant(Date)
}

/// The first date phrase that does not overlap `claimed` (UTF-16 ranges), as an ISO value. Bare dates are all-day
/// (UTC midnight of the local day); a phrase with a time of day is a timed instant.
func firstQuickAddDate(in raw: String, avoiding claimed: [Range<Int>], now: Date, calendar: Calendar) -> QuickAddDateMatch? {
    let text = NSString(string: raw)
    var candidates = dateCandidates(text, now: now, calendar: calendar)
    candidates += standaloneTimeCandidates(text, now: now, calendar: calendar)
    candidates.sort { $0.start < $1.start }
    return candidates.first { candidate in
        !claimed.contains { candidate.start < $0.upperBound && candidate.end > $0.lowerBound }
    }
}

private func dateCandidates(_ text: NSString, now: Date, calendar: Calendar) -> [QuickAddDateMatch] {
    guard let regex = RegexCache.regex(datePattern, options: [.caseInsensitive]) else { return [] }
    var found: [QuickAddDateMatch] = []
    for match in regex.matches(in: text as String, range: NSRange(location: 0, length: text.length)) {
        let phrase = text.substring(with: match.range)
        guard let resolved = resolve(phrase, now: now, calendar: calendar) else { continue }
        var end = match.range.location + match.range.length
        var value = resolved
        if case .day(let day) = resolved, let merged = trailingTime(text, from: end, day: day, calendar: calendar) {
            value = .instant(merged.date)
            end = merged.end
        }
        let span = NSRange(location: match.range.location, length: end - match.range.location)
        found.append(QuickAddDateMatch(
            start: span.location, end: end, text: text.substring(with: span), iso: iso(for: value, calendar: calendar)
        ))
    }
    return found
}

private func standaloneTimeCandidates(_ text: NSString, now: Date, calendar: Calendar) -> [QuickAddDateMatch] {
    guard let regex = RegexCache.regex(standaloneTimePattern, options: [.caseInsensitive]) else { return [] }
    var found: [QuickAddDateMatch] = []
    for match in regex.matches(in: text as String, range: NSRange(location: 0, length: text.length)) {
        let phrase = text.substring(with: match.range)
        guard let time = parseTime(phrase) else { continue }
        let today = calendar.startOfDay(for: now)
        guard var instant = calendar.date(bySettingHour: time.hour, minute: time.minute, second: 0, of: today) else { continue }
        if instant < now, let tomorrow = calendar.date(byAdding: .day, value: 1, to: instant) { instant = tomorrow }
        found.append(QuickAddDateMatch(
            start: match.range.location, end: match.range.location + match.range.length, text: phrase,
            iso: DueDates.timedISO(instant)
        ))
    }
    return found
}

private func iso(for value: ResolvedDate, calendar: Calendar) -> String {
    switch value {
    case .day(let day): return DueDates.allDayISO(for: day, calendar: calendar)
    case .instant(let date): return DueDates.timedISO(date)
    }
}

/// "at 5pm", "17:30", "5 pm": the time inside a phrase. Nil when the hour or minute is out of range.
private func parseTime(_ phrase: String) -> TimeOfDay? {
    let lower = phrase.lowercased()
    let digits = lower.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
    guard var hour = digits.first else { return nil }
    let minute = digits.count > 1 ? digits[1] : 0
    guard minute < 60 else { return nil }
    if lower.hasSuffix("pm") || lower.hasSuffix("am") {
        guard (1...12).contains(hour) else { return nil }
        hour = hour % 12 + (lower.hasSuffix("pm") ? 12 : 0)
    }
    return hour < 24 ? TimeOfDay(hour: hour, minute: minute) : nil
}

/// A time of day right after a date phrase. Needs am or pm, minutes, or "at", so "tomorrow 5 apples" stays text.
private func trailingTime(_ text: NSString, from offset: Int, day: Date, calendar: Calendar) -> (date: Date, end: Int)? {
    guard let regex = RegexCache.regex(trailingTimePattern, options: [.caseInsensitive]) else { return nil }
    let range = NSRange(location: offset, length: text.length - offset)
    guard let match = regex.firstMatch(in: text as String, range: range) else { return nil }
    let hasAt = match.range(at: 1).location != NSNotFound
    let hasMinutes = match.range(at: 3).location != NSNotFound
    let hasMeridiem = match.range(at: 4).location != NSNotFound
    guard hasAt || hasMinutes || hasMeridiem else { return nil }
    let phrase = text.substring(with: match.range)
    guard let time = parseTime(phrase), let date = calendar.date(bySettingHour: time.hour, minute: time.minute, second: 0, of: day) else {
        return nil
    }
    return (date, match.range.location + match.range.length)
}

private func resolve(_ phrase: String, now: Date, calendar: Calendar) -> ResolvedDate? {
    let words = phrase.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    guard let first = words.first else { return nil }
    let today = calendar.startOfDay(for: now)
    switch first {
    case "today", "tonight": return .day(today)
    case "tomorrow", "tmrw": return shifted(today, days: 1, calendar: calendar)
    case "yesterday": return shifted(today, days: -1, calendar: calendar)
    case "in": return relative(words, now: now, calendar: calendar)
    default: break
    }
    if words == ["next", "week"] { return shifted(today, days: 7, calendar: calendar) }
    if let weekday = weekdayNumber(words.last ?? ""), words.count <= 2 {
        return weekdayDate(weekday, isNext: first == "next", today: today, calendar: calendar)
    }
    return calendarPhrase(phrase.lowercased(), now: now, calendar: calendar)
}

private func shifted(_ day: Date, days: Int, calendar: Calendar) -> ResolvedDate? {
    calendar.date(byAdding: .day, value: days, to: day).map(ResolvedDate.day)
}

private func relative(_ words: [String], now: Date, calendar: Calendar) -> ResolvedDate? {
    guard words.count == 3, let amount = Int(words[1]) else { return nil }
    let unit = words[2]
    let component: Calendar.Component
    switch unit.prefix(3) {
    case "min": component = .minute
    case "hou", "hrs": component = .hour
    case "day": component = .day
    case "wee": component = .weekOfYear
    case "mon": component = .month
    case "yea": component = .year
    default: return nil
    }
    guard let moved = calendar.date(byAdding: component, value: amount, to: now) else { return nil }
    if component == .minute || component == .hour { return .instant(moved) }
    return .day(calendar.startOfDay(for: moved))
}

private func weekdayNumber(_ word: String) -> Int? {
    let names = ["sun": 1, "mon": 2, "tue": 3, "wed": 4, "thu": 5, "fri": 6, "sat": 7]
    return names[String(word.prefix(3))]
}

/// A bare or "this" weekday is today or the next one coming. "next" skips today, so it is always 1 to 7 days away.
private func weekdayDate(_ weekday: Int, isNext: Bool, today: Date, calendar: Calendar) -> ResolvedDate? {
    let current = calendar.component(.weekday, from: today)
    var delta = (weekday - current + 7) % 7
    if isNext && delta == 0 { delta = 7 }
    return shifted(today, days: delta, calendar: calendar)
}

/// ISO dates and month-day phrases. Without a year, a date already past rolls to next year (forward dates).
private func calendarPhrase(_ phrase: String, now: Date, calendar: Calendar) -> ResolvedDate? {
    if phrase.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
        let parts = phrase.split(separator: "-").compactMap { Int($0) }
        return dateFrom(year: parts[0], month: parts[1], day: parts[2], calendar: calendar).map(ResolvedDate.day)
    }
    let tokens = phrase.replacingOccurrences(of: ",", with: " ").replacingOccurrences(of: ".", with: " ")
        .split(whereSeparator: \.isWhitespace).map(String.init).filter { $0 != "of" }
    var month: Int?
    var day: Int?
    var year: Int?
    for token in tokens {
        let digits = token.prefix { $0.isNumber }
        if let number = Int(digits), token.count == digits.count || token.dropFirst(digits.count).count == 2 {
            if digits.count == 4 { year = number } else { day = number }
        } else if let named = monthNumber(token) {
            month = named
        }
    }
    guard let month, let day else { return nil }
    let currentYear = calendar.component(.year, from: now)
    guard var resolved = dateFrom(year: year ?? currentYear, month: month, day: day, calendar: calendar) else { return nil }
    if year == nil, resolved < calendar.startOfDay(for: now),
       let next = dateFrom(year: currentYear + 1, month: month, day: day, calendar: calendar) {
        resolved = next
    }
    return .day(resolved)
}

private func monthNumber(_ word: String) -> Int? {
    let names = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12]
    return names[String(word.prefix(3))]
}

private func dateFrom(year: Int, month: Int, day: Int, calendar: Calendar) -> Date? {
    guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
          calendar.component(.month, from: date) == month,
          calendar.component(.day, from: date) == day else { return nil }
    return date
}
