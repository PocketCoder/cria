import Foundation

public enum SearchToken: Equatable, Sendable {
    case text(String)
    case date(text: String, start: String, end: String)
    case label(text: String, title: String)
    case priority(text: String, value: Int)
}

public struct SearchQuery: Equatable, Sendable {
    /// Plain text to feed to FTS5 (everything after stripping filters).
    public var text: String
    public var dueDateStart: String?
    public var dueDateEnd: String?
    public var labelTitle: String?
    public var priority: Int?
    /// From words like "high priority" or "urgent": this priority or above.
    public var minimumPriority: Int?
    /// From "overdue": done tasks are left out.
    public var onlyOpen = false
    public var tokens: [SearchToken]

    public init(
        text: String,
        dueDateStart: String? = nil,
        dueDateEnd: String? = nil,
        labelTitle: String? = nil,
        priority: Int? = nil,
        tokens: [SearchToken] = []
    ) {
        self.text = text
        self.dueDateStart = dueDateStart
        self.dueDateEnd = dueDateEnd
        self.labelTitle = labelTitle
        self.priority = priority
        self.tokens = tokens
    }
}

private enum ClaimedKind {
    case label(title: String)
    case priority(value: Int)
    case minimumPriority(value: Int)
    case date(start: String?, end: String)
    case overdue(end: String)
}

/// A symbol or date found in the input. Offsets are UTF-16 (NSString) positions.
private struct ClaimedToken {
    let start: Int
    let end: Int
    let text: String
    let kind: ClaimedKind
}

private let labelPattern = #"(?:^|\s)(#"[^"]+"|#[A-Za-z0-9_-]+)(?=\s|$)"#
private let priorityPattern = #"(?:^|\s)(![1-5])(?=\s|$)"#
private let soonPattern = #"(?:^|\s)(soon)(?=\s|$)"#
private let overduePattern = #"(?:^|\s)(overdue|late)(?=\s|$)"#
private let priorityWordsPattern =
    #"(?:^|\s)((?:(?:low|medium|high|urgent|top)\s+priority|priority\s+(?:low|medium|high|urgent)|urgent|important))(?=\s|$)"#

/// Words that carry no meaning once a filter is found ("tasks due tomorrow" is a date, not a search for "tasks due").
private let fillerWords: Set<String> = [
    "task", "tasks", "todo", "todos", "to-dos", "due", "on", "by", "for", "with", "show", "me", "all", "my", "that",
    "are", "is", "what", "whats", "what's", "find", "list", "everything", "things", "anything", "the", "of", "in"
]

/// Finds `pattern` and returns capture group 1 of each match as (UTF-16 range, text).
private func captures(_ pattern: String, in raw: String, options: NSRegularExpression.Options = []) -> [(range: NSRange, text: String)] {
    guard let regex = RegexCache.regex(pattern, options: options) else { return [] }
    let nsRaw = NSString(string: raw)
    return regex.matches(in: raw, range: NSRange(location: 0, length: nsRaw.length)).compactMap { match in
        let range = match.range(at: 1)
        guard range.location != NSNotFound else { return nil }
        return (range: range, text: nsRaw.substring(with: range))
    }
}

private func symbolTokens(in raw: String) -> [ClaimedToken] {
    var claimed: [ClaimedToken] = []
    for found in captures(labelPattern, in: raw) {
        let title = found.text.hasPrefix("#\"")
            ? String(found.text.dropFirst(2).dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
            : String(found.text.dropFirst())
        if !title.isEmpty {
            claimed.append(ClaimedToken(
                start: found.range.location, end: found.range.location + found.range.length,
                text: found.text, kind: .label(title: title)
            ))
        }
    }
    for found in captures(priorityPattern, in: raw) {
        claimed.append(ClaimedToken(
            start: found.range.location, end: found.range.location + found.range.length,
            text: found.text, kind: .priority(value: Int(found.text.dropFirst()) ?? 0)
        ))
    }
    return claimed
}

private func wordTokens(in raw: String, now: Date, calendar: Calendar) -> [ClaimedToken] {
    var result: [ClaimedToken] = []
    if let overdue = captures(overduePattern, in: raw, options: [.caseInsensitive]).first {
        result.append(ClaimedToken(
            start: overdue.range.location, end: overdue.range.location + overdue.range.length, text: overdue.text,
            kind: .overdue(end: QueryDates.utcEndOfDay(of: now, plusDays: -1, calendar: calendar))
        ))
    }
    if let words = captures(priorityWordsPattern, in: raw, options: [.caseInsensitive]).first {
        let lower = words.text.lowercased()
        let value = lower.contains("low") ? 1 : lower.contains("medium") ? 2 : lower.contains("high") || lower == "important" ? 3 : 4
        result.append(ClaimedToken(
            start: words.range.location, end: words.range.location + words.range.length, text: words.text,
            kind: .minimumPriority(value: value)
        ))
    }
    return result
}

private func dateTokens(in raw: String, claimed: [ClaimedToken], now: Date, calendar: Calendar) -> [ClaimedToken] {
    var result: [ClaimedToken] = []
    if let soon = captures(soonPattern, in: raw, options: [.caseInsensitive]).first {
        result.append(ClaimedToken(
            start: soon.range.location, end: soon.range.location + soon.range.length, text: soon.text,
            kind: .date(start: nil, end: QueryDates.utcEndOfDay(of: now, plusDays: 14, calendar: calendar))
        ))
    }
    let ranges = (claimed + result).map { $0.start..<$0.end }
    let hasOverdue = claimed.contains { if case .overdue = $0.kind { return true } else { return false } }
    if !hasOverdue, let phrase = firstDatePhrase(in: raw, avoiding: ranges, now: now, calendar: calendar) {
        result.append(ClaimedToken(
            start: phrase.start, end: phrase.end, text: phrase.text,
            kind: .date(start: phrase.startIso, end: phrase.endIso)
        ))
    }
    return result
}

private func plainText(raw: String, claimed: [ClaimedToken]) -> String {
    let nsRaw = NSString(string: raw)
    var text = ""
    var cursor = 0
    for token in claimed {
        if token.start > cursor {
            text += nsRaw.substring(with: NSRange(location: cursor, length: token.start - cursor))
        }
        cursor = token.end
    }
    if cursor < nsRaw.length {
        text += nsRaw.substring(from: cursor)
    }
    return text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func tokenList(raw: String, claimed: [ClaimedToken]) -> [SearchToken] {
    let nsRaw = NSString(string: raw)
    var tokens: [SearchToken] = []
    var walk = 0
    for token in claimed {
        if token.start > walk {
            tokens.append(.text(nsRaw.substring(with: NSRange(location: walk, length: token.start - walk))))
        }
        switch token.kind {
        case .date(let start?, let end):
            tokens.append(.date(text: token.text, start: start, end: end))
        case .date, .overdue, .minimumPriority:
            break
        case .label(let title):
            tokens.append(.label(text: token.text, title: title))
        case .priority(let value):
            tokens.append(.priority(text: token.text, value: value))
        }
        walk = token.end
    }
    if walk < nsRaw.length {
        tokens.append(.text(nsRaw.substring(from: walk)))
    }
    return tokens
}

/// Splits a search string into FTS text plus structured filters (`#label`, `!1`-`!5`, one date phrase, `soon`).
/// Dates resolve against `now` in `calendar`'s time zone and are emitted as UTC day bounds.
public func parseSearchQuery(_ input: String, now: Date = Date(), calendar: Calendar = .cria) -> SearchQuery {
    var claimed = symbolTokens(in: input)
    let taken = claimed.map { $0.start..<$0.end }
    claimed += wordTokens(in: input, now: now, calendar: calendar).filter { word in
        !taken.contains { word.start < $0.upperBound && word.end > $0.lowerBound }
    }
    claimed += dateTokens(in: input, claimed: claimed, now: now, calendar: calendar)
    claimed.sort { $0.start < $1.start }

    var text = plainText(raw: input, claimed: claimed)
    // Only after a worded filter: "task !3" still searches for "task".
    let worded = claimed.contains { token in
        switch token.kind {
        case .date, .overdue, .minimumPriority: true
        case .label, .priority: false
        }
    }
    if worded {
        text = text.split(separator: " ").filter { !fillerWords.contains($0.lowercased()) }.joined(separator: " ")
    }
    var query = SearchQuery(text: text)
    for token in claimed {
        switch token.kind {
        case .date(let start, let end):
            query.dueDateStart = start
            query.dueDateEnd = end
        case .label(let title):
            query.labelTitle = title
        case .priority(let value):
            query.priority = max(query.priority ?? value, value)
        case .minimumPriority(let value):
            query.minimumPriority = value
        case .overdue(let end):
            query.dueDateEnd = end
            query.onlyOpen = true
        }
    }
    query.tokens = tokenList(raw: input, claimed: claimed)
    return query
}
