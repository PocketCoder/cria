import Foundation

public enum QuickAddTokenKind: Equatable, Sendable {
    case text
    case date(iso: String)
    case priority(Int)
    case label(String)
    case assignee(String)
    case project(String)
    case recurrence(repeatAfter: Int?, repeatMode: Int?)
}

/// A slice of the input for live preview. `start` and `end` are UTF-16 offsets.
public struct QuickAddToken: Equatable, Sendable {
    public let kind: QuickAddTokenKind
    public let start: Int
    public let end: Int
    public let text: String
}

public struct QuickAddResult: Equatable, Sendable {
    public var title: String
    public var dueDate: String?
    public var priority: Int?
    public var labelTitles: [String]
    public var assigneeUsernames: [String]
    public var projectTitle: String?
    public var repeatAfter: Int?
    public var repeatMode: Int?
    public var tokens: [QuickAddToken]
}

private let bareName = "[A-Za-z0-9_-]+"
private let quoteClass = "[\"\u{201C}\u{201D}]"
private let notQuote = "[^\"\u{201C}\u{201D}]"

private let recurrencePattern = [
    #"(?:^|\s)((?:every\s+\d+\s+(?:day|week|month|year|hour)s?|every\s+(?:day|week|month|year|hour)"#,
    #"|(?:daily|weekly|monthly|yearly|hourly)"#,
    #"|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)))(?=\s|$)"#
].joined()

private let secondsPerUnit: [String: Int] = ["day": 86_400, "week": 604_800, "month": 2_592_000, "year": 31_536_000, "hour": 3_600]

/// Whether a project or label name cannot be written bare after its prefix and needs the quoted form.
/// Anything outside `[A-Za-z0-9_-]` (spaces, accents, apostrophes) does.
public func quickAddNeedsQuoting(_ name: String) -> Bool {
    name.range(of: "^\(bareName)$", options: .regularExpression) == nil
}

/// Parses a quick-add line in the Vikunja-web style: `Buy milk tomorrow at 5pm *groceries !2 @alice +Personal`.
/// Ported from `src/lib/quickAddParser.ts`; see that file for the token rules. Input wrapped in a matching pair of
/// quotes is a literal title in every mode. A title left empty by the magic stays empty here; use
/// `parseQuickAddTask` for the line a task is created from.
public func parseQuickAdd(
    _ input: String,
    now: Date = Date(),
    mode: QuickAddMagicMode = .default,
    calendar: Calendar = .cria
) -> QuickAddResult {
    if let literal = unquoteLiteral(input) { return plainTitle(input, title: literal) }
    guard let prefixes = mode.prefixes else { return plainTitle(input) }
    let raw = NSString(string: input)
    var claimed = symbolTokens(raw, prefixes: prefixes)
    claimed += recurrenceTokens(raw, avoiding: claimed)
    if let pending = openQuoteToken(raw, prefixes: prefixes), !overlaps(pending, claimed) { claimed.append(pending) }
    let claimedRanges = claimed.map { $0.start..<$0.end }
    if let date = firstQuickAddDate(in: input, avoiding: claimedRanges, now: now, calendar: calendar) {
        claimed.append(QuickAddToken(kind: .date(iso: date.iso), start: date.start, end: date.end, text: date.text))
    }
    claimed.sort { $0.start < $1.start }
    return assemble(raw, claimed: claimed)
}

/// The parse a typed line creates its task from: when the magic leaves no title (the line is only tokens, or an
/// empty quoted pair) the line stays a literal title and nothing parsed from it applies.
public func parseQuickAddTask(
    _ input: String,
    now: Date = Date(),
    mode: QuickAddMagicMode = .default,
    calendar: Calendar = .cria
) -> QuickAddResult {
    let parsed = parseQuickAdd(input, now: now, mode: mode, calendar: calendar)
    let blank = input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return parsed.title.isEmpty && !blank ? plainTitle(input) : parsed
}

// MARK: Literal titles

private let curlyPairs: [Character: Character] = ["\u{201C}": "\u{201D}", "\u{2018}": "\u{2019}"]

/// Text inside a wrapping pair of quotes (straight, or curly pairs), or nil when the input is not wrapped.
private func unquoteLiteral(_ input: String) -> String? {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count >= 2, let opening = text.first, let last = text.last else { return nil }
    let close: Character? = curlyPairs[opening] ?? (opening == "\"" || opening == "'" ? opening : nil)
    guard let close, last == close else { return nil }
    return String(text.dropFirst().dropLast())
}

private func plainTitle(_ raw: String, title: String? = nil) -> QuickAddResult {
    let length = raw.utf16.count
    let tokens = length > 0 ? [QuickAddToken(kind: .text, start: 0, end: length, text: raw)] : []
    return QuickAddResult(
        title: (title ?? raw).trimmingCharacters(in: .whitespacesAndNewlines),
        dueDate: nil, priority: nil, labelTitles: [], assigneeUsernames: [], projectTitle: nil,
        repeatAfter: nil, repeatMode: nil, tokens: tokens
    )
}

// MARK: Token scanning

private func escaped(_ prefix: String) -> String {
    NSRegularExpression.escapedPattern(for: prefix)
}

private func overlaps(_ token: QuickAddToken, _ others: [QuickAddToken]) -> Bool {
    others.contains { token.start < $0.end && token.end > $0.start }
}

/// Every match of `pattern`, as the text and offsets of capture group 1.
private func groupMatches(_ pattern: String, in raw: NSString, caseInsensitive: Bool = false) -> [(text: String, range: NSRange)] {
    let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
    guard let regex = RegexCache.regex(pattern, options: options) else { return [] }
    return regex.matches(in: raw as String, range: NSRange(location: 0, length: raw.length)).map { match in
        (raw.substring(with: match.range(at: 1)), match.range(at: 1))
    }
}

private func token(_ kind: QuickAddTokenKind, _ found: (text: String, range: NSRange)) -> QuickAddToken {
    QuickAddToken(kind: kind, start: found.range.location, end: found.range.location + found.range.length, text: found.text)
}

/// Strips the prefix and a surrounding quote pair from `*"two words"` or `*word`.
private func quotedName(_ text: String, prefix: String) -> String {
    let rest = String(text.dropFirst(prefix.count))
    let quotes = Set<Character>(["\"", "\u{201C}", "\u{201D}"])
    if rest.count >= 2, let first = rest.first, let last = rest.last, quotes.contains(first), quotes.contains(last) {
        return String(rest.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return rest
}

private func symbolTokens(_ raw: NSString, prefixes: QuickAddPrefixes) -> [QuickAddToken] {
    var found: [QuickAddToken] = []
    func quotable(_ prefix: String) -> String {
        let escapedPrefix = escaped(prefix)
        return #"(?:^|\s)("# + "\(escapedPrefix)\(quoteClass)\(notQuote)+\(quoteClass)|\(escapedPrefix)\(bareName))" + #"(?=\s|$)"#
    }
    for hit in groupMatches(quotable(prefixes.label), in: raw) {
        let title = quotedName(hit.text, prefix: prefixes.label)
        if !title.isEmpty { found.append(token(.label(title), hit)) }
    }
    for hit in groupMatches(#"(?:^|\s)("# + "\(escaped(prefixes.priority))[1-5])" + #"(?=\s|$)"#, in: raw) {
        let value = Int(hit.text.dropFirst(prefixes.priority.count)) ?? 0
        found.append(token(.priority(value), hit))
    }
    for hit in groupMatches(#"(?:^|\s)("# + "\(escaped(prefixes.assignee))\(bareName))" + #"(?=\s|$)"#, in: raw) {
        found.append(token(.assignee(String(hit.text.dropFirst(prefixes.assignee.count))), hit))
    }
    for hit in groupMatches(quotable(prefixes.project), in: raw) {
        let title = quotedName(hit.text, prefix: prefixes.project)
        if !title.isEmpty { found.append(token(.project(title), hit)) }
    }
    return found
}

private func recurrenceTokens(_ raw: NSString, avoiding claimed: [QuickAddToken]) -> [QuickAddToken] {
    var found: [QuickAddToken] = []
    for hit in groupMatches(recurrencePattern, in: raw, caseInsensitive: true) {
        guard let parsed = parseRecurrence(hit.text) else { continue }
        let candidate = token(.recurrence(repeatAfter: parsed.after, repeatMode: parsed.mode), hit)
        if !overlaps(candidate, claimed) { found.append(candidate) }
    }
    return found
}

/// While typing `*"two words` with no closing quote yet, show the chip so the preview does not flicker.
private func openQuoteToken(_ raw: NSString, prefixes: QuickAddPrefixes) -> QuickAddToken? {
    let pattern = "(?:^|\\s)(\(escaped(prefixes.label))|\(escaped(prefixes.project)))(\(quoteClass))(\(notQuote)*)$"
    guard let regex = RegexCache.regex(pattern),
          let match = regex.firstMatch(in: raw as String, range: NSRange(location: 0, length: raw.length)) else { return nil }
    let prefix = raw.substring(with: match.range(at: 1))
    let name = raw.substring(with: match.range(at: 3)).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return nil }
    let start = match.range(at: 1).location
    let text = raw.substring(from: start)
    let kind: QuickAddTokenKind = prefix == prefixes.label ? .label(name) : .project(name)
    return QuickAddToken(kind: kind, start: start, end: raw.length, text: text)
}

// MARK: Recurrence

private struct Recurrence {
    let after: Int?
    let mode: Int?
}

private let keywordUnits = ["daily": "day", "weekly": "week", "monthly": "month", "yearly": "year", "hourly": "hour"]
private let weekdayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

/// "every 2 weeks", "daily", "every monday". A single month is Vikunja's monthly mode (it ignores repeat_after);
/// "every N months" (N > 1) is approximated as N x 30 days rather than dropping the N.
private func parseRecurrence(_ text: String) -> Recurrence? {
    let words = text.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    if words.count == 3, let amount = Int(words[1]) {
        let unit = words[2].hasSuffix("s") ? String(words[2].dropLast()) : words[2]
        if unit == "month", amount == 1 { return Recurrence(after: nil, mode: 1) }
        // A huge number must not trap the multiplication: this runs on every keystroke.
        return secondsPerUnit[unit].flatMap { seconds in
            let (product, overflow) = amount.multipliedReportingOverflow(by: seconds)
            return overflow ? nil : Recurrence(after: product, mode: 0)
        }
    }
    if words.count == 2, words[0] == "every" {
        return weekdayNames.contains(words[1]) ? Recurrence(after: 604_800, mode: 0) : unitRecurrence(words[1])
    }
    return words.count == 1 ? keywordUnits[words[0]].flatMap(unitRecurrence) : nil
}

private func unitRecurrence(_ unit: String) -> Recurrence? {
    if unit == "month" { return Recurrence(after: nil, mode: 1) }
    return secondsPerUnit[unit].map { Recurrence(after: $0, mode: 0) }
}

// MARK: Assembly

private func assemble(_ raw: NSString, claimed: [QuickAddToken]) -> QuickAddResult {
    var result = QuickAddResult(
        title: "", dueDate: nil, priority: nil, labelTitles: [], assigneeUsernames: [], projectTitle: nil,
        repeatAfter: nil, repeatMode: nil, tokens: []
    )
    var title = ""
    var cursor = 0
    var walk = 0
    for item in claimed {
        if item.start > cursor { title += raw.substring(with: NSRange(location: cursor, length: item.start - cursor)) }
        cursor = item.end
        if item.start > walk {
            let text = raw.substring(with: NSRange(location: walk, length: item.start - walk))
            result.tokens.append(QuickAddToken(kind: .text, start: walk, end: item.start, text: text))
        }
        result.tokens.append(item)
        walk = item.end
        record(item.kind, into: &result)
    }
    if cursor < raw.length { title += raw.substring(from: cursor) }
    if walk < raw.length {
        result.tokens.append(QuickAddToken(kind: .text, start: walk, end: raw.length, text: raw.substring(from: walk)))
    }
    result.title = title.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return result
}

private func record(_ kind: QuickAddTokenKind, into result: inout QuickAddResult) {
    switch kind {
    case .label(let title): result.labelTitles.append(title)
    case .assignee(let username): result.assigneeUsernames.append(username)
    case .project(let title): result.projectTitle = title
    case .priority(let value): result.priority = max(result.priority ?? value, value)
    case .date(let iso): if result.dueDate == nil { result.dueDate = iso }
    case .recurrence(let after, let mode):
        if result.repeatAfter == nil || result.repeatAfter == 0 { result.repeatAfter = after }
        if result.repeatMode == nil || result.repeatMode == 0 { result.repeatMode = mode }
    case .text: break
    }
}
