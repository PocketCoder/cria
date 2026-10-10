import Foundation

/// A natural-language date found in a search string. The TypeScript uses chrono-node; this is a
/// small deterministic subset (see `parseDatePhrase`).
struct DatePhraseMatch {
    let start: Int
    let end: Int
    let text: String
    /// nil means no lower bound (includes overdue).
    let startIso: String?
    let endIso: String
}

private let datePhrasePattern = [
    #"\b(?:(?:this|next)\s+(?:week|wk)"#,
    "|today|tonight|tomorrow|tmrw|yesterday",
    #"|(?:(?:next|this|on)\s+)?(?:monday|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sunday)"#,
    #"|in\s+\d+\s+(?:days?|weeks?|months?)"#,
    #"|\d{4}-\d{2}-\d{2})\b"#
].joined()

private let weekdayNumbers: [String: Int] = [
    "sun": 1, "mon": 2, "tue": 3, "wed": 4, "thu": 5, "fri": 6, "sat": 7
]

/// Returns the first phrase that does not overlap `claimed` (UTF-16 ranges) and resolves to a date.
func firstDatePhrase(in raw: String, avoiding claimed: [Range<Int>], now: Date, calendar: Calendar) -> DatePhraseMatch? {
    guard let regex = try? NSRegularExpression(pattern: datePhrasePattern, options: [.caseInsensitive]) else {
        return nil
    }
    let nsRaw = NSString(string: raw)
    for match in regex.matches(in: raw, range: NSRange(location: 0, length: nsRaw.length)) {
        let range = match.range
        let span = range.location..<(range.location + range.length)
        if claimed.contains(where: { span.lowerBound < $0.upperBound && span.upperBound > $0.lowerBound }) {
            continue
        }
        let text = nsRaw.substring(with: range)
        if let bounds = resolveDatePhrase(text, now: now, calendar: calendar) {
            return DatePhraseMatch(start: span.lowerBound, end: span.upperBound, text: text, startIso: bounds.start, endIso: bounds.end)
        }
    }
    return nil
}

private struct DateBounds {
    let start: String?
    let end: String
}

private func resolveDatePhrase(_ text: String, now: Date, calendar: Calendar) -> DateBounds? {
    let words = text.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    guard let first = words.first, let last = words.last else { return nil }
    if first == "in", words.count == 3 {
        return relativeBounds(words, now: now, calendar: calendar)
    }
    if last == "week" || last == "wk" {
        if first == "this" {
            return DateBounds(start: nil, end: QueryDates.utcEndOfWeek(of: now, weekStartsOn: 1, calendar: calendar))
        }
        return dayBounds(offsetDays: 7, now: now, calendar: calendar)
    }
    if let offset = simpleOffsets[first] {
        return dayBounds(offsetDays: offset, now: now, calendar: calendar)
    }
    if first.count == 10, first.contains("-") {
        return isoDateBounds(first, calendar: calendar)
    }
    return weekdayBounds(words, now: now, calendar: calendar)
}

private let simpleOffsets: [String: Int] = [
    "today": 0, "tonight": 0, "tomorrow": 1, "tmrw": 1, "yesterday": -1
]

private func dayBounds(offsetDays: Int, now: Date, calendar: Calendar) -> DateBounds {
    DateBounds(
        start: QueryDates.utcMidnight(of: now, plusDays: offsetDays, calendar: calendar),
        end: QueryDates.utcEndOfDay(of: now, plusDays: offsetDays, calendar: calendar)
    )
}

private func relativeBounds(_ words: [String], now: Date, calendar: Calendar) -> DateBounds? {
    guard let amount = Int(words[1]) else { return nil }
    if words[2].hasPrefix("month") {
        guard let shifted = calendar.date(byAdding: .month, value: amount, to: now) else { return nil }
        return dayBounds(offsetDays: 0, now: shifted, calendar: calendar)
    }
    let days = words[2].hasPrefix("week") ? amount * 7 : amount
    return dayBounds(offsetDays: days, now: now, calendar: calendar)
}

private func isoDateBounds(_ text: String, calendar: Calendar) -> DateBounds? {
    let parts = text.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3,
          let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) else {
        return nil
    }
    return dayBounds(offsetDays: 0, now: date, calendar: calendar)
}

private func weekdayBounds(_ words: [String], now: Date, calendar: Calendar) -> DateBounds? {
    guard let name = words.last, let target = weekdayNumbers[String(name.prefix(3))] else { return nil }
    let current = calendar.component(.weekday, from: now)
    var diff = (target - current + 7) % 7
    if words.first == "next", diff == 0 {
        diff = 7
    }
    return dayBounds(offsetDays: diff, now: now, calendar: calendar)
}
