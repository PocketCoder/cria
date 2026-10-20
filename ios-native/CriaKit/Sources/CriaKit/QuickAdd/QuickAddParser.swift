import Foundation

public enum QuickAddTokenKind: Equatable, Sendable {
    case text
    case date(iso: String)
    case priority(Int)
    case label(String)
    case assignee(String)
    case project(String)
    case recurrence(repeatAfter: Int?, repeatMode: Int?)
    case reminder(QuickAddReminder)
}

/// A slice of the input for live preview. `start` and `end` are UTF-16 offsets.
public struct QuickAddToken: Equatable, Sendable {
    public let kind: QuickAddTokenKind
    public let start: Int
    public let end: Int
    public let text: String
    /// True for text the title keeps (Vikunja-web leaves `@name` in place); other tokens are cut from the title.
    public var inTitle: Bool = false
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
    /// Typed "remind …" phrases, in order.
    public var reminders: [QuickAddReminder] = []
}

private let bareName = "[A-Za-z0-9_-]+"
private let quoteClass = "[\"\u{201C}\u{201D}]"
private let notQuote = "[^\"\u{201C}\u{201D}]"

/// Whether a project or label name cannot be written bare after its prefix and needs the quoted form.
/// Anything outside `[A-Za-z0-9_-]` (spaces, accents, apostrophes) does.
public func quickAddNeedsQuoting(_ name: String) -> Bool {
    name.range(of: "^\(bareName)$", options: .regularExpression) == nil
}

/// Parses a quick-add line the way Vikunja-web's Quick Add Magic does: `Buy milk tomorrow at 5pm *groceries !2 @alice +Personal`.
/// The steps and their order follow Vikunja-web's `parseTaskText` (labels, project, priority, assignees, repeats,
/// then the date); see `QuickAddSymbols.swift` and `QuickAddMagicDate.swift` for where Cria differs on purpose.
/// Input wrapped in a matching pair of quotes is a literal title in every mode. A title left empty by the magic stays
/// empty here; use `parseQuickAddTask` for the line a task is created from. With `detectDates` off (Settings >
/// Customise) dates stay in the title. A date typed without a time takes `defaultDueTime` (Vikunja-web's
/// `default_due_time`, see `QuickAddDefaults`); a phrase that names a time keeps it.
public func parseQuickAdd(
    _ input: String,
    now: Date = Date(),
    mode: QuickAddMagicMode = .default,
    calendar: Calendar = .cria,
    detectDates: Bool = true,
    defaultDueTime: DefaultDueTime? = nil
) -> QuickAddResult {
    if let literal = unquoteLiteral(input) { return plainTitle(input, title: literal) }
    guard let prefixes = mode.prefixes else { return plainTitle(input) }
    var work = QuickAddWorkingText(input)
    var result = plainTitle("")
    scanSymbols(&work, prefixes: prefixes, into: &result)
    if let repeats = quickAddCutRepeat(from: &work) {
        result.repeatAfter = repeats.after
        result.repeatMode = repeats.mode
    }
    if detectDates {
        cutReminders(&work, into: &result)
        let context = QuickAddDateContext(now: now, calendar: calendar, defaultDueTime: defaultDueTime, rules: CriaRules.current)
        result.dueDate = applyMagicDate(to: &work, context: context)
    }
    return assemble(work, into: result)
}

/// The parse a typed line creates its task from: when the magic leaves no title (the line is only tokens, or an
/// empty quoted pair) the line stays a literal title and nothing parsed from it applies.
public func parseQuickAddTask(
    _ input: String,
    now: Date = Date(),
    mode: QuickAddMagicMode = .default,
    calendar: Calendar = .cria,
    detectDates: Bool = true,
    defaultDueTime: DefaultDueTime? = nil
) -> QuickAddResult {
    let parsed = parseQuickAdd(
        input, now: now, mode: mode, calendar: calendar, detectDates: detectDates, defaultDueTime: defaultDueTime
    )
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

// MARK: Scanning

private func scanSymbols(_ work: inout QuickAddWorkingText, prefixes: QuickAddPrefixes, into result: inout QuickAddResult) {
    cutOpenQuote(&work, prefixes: prefixes, into: &result)
    for label in quickAddItems(in: work.string, prefix: prefixes.label) {
        result.labelTitles.append(label)
        quickAddCut(label, prefix: prefixes.label, as: .label(label), from: &work)
    }
    if let project = quickAddItems(in: work.string, prefix: prefixes.project).first {
        result.projectTitle = project
        quickAddCut(project, prefix: prefixes.project, as: .project(project), from: &work)
    }
    if let priority = quickAddPriority(in: work.string, prefix: prefixes.priority) {
        result.priority = priority
        quickAddCut(String(priority), prefix: prefixes.priority, as: .priority(priority), exact: false, from: &work)
    }
    // Vikunja-web does not cut assignees out, in case the name is no user: `@name` stays in the title.
    for assignee in quickAddItems(in: work.string, prefix: prefixes.assignee) {
        result.assigneeUsernames.append(assignee)
        quickAddMarkAssignee(assignee, prefix: prefixes.assignee, in: &work)
    }
}

/// While typing `*"two words` with no closing quote yet, show the chip so the preview does not flicker.
private func cutOpenQuote(_ work: inout QuickAddWorkingText, prefixes: QuickAddPrefixes, into result: inout QuickAddResult) {
    let label = NSRegularExpression.escapedPattern(for: prefixes.label)
    let project = NSRegularExpression.escapedPattern(for: prefixes.project)
    let pattern = "(?:^|\\s)(\(label)|\(project))(\(quoteClass))(\(notQuote)*)$"
    let text = work.current
    guard let match = quickAddFirstMatch(pattern, in: text) else { return }
    let name = text.substring(with: match.range(at: 3)).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    let start = match.range(at: 1).location
    let range = NSRange(location: start, length: text.length - start)
    if text.substring(with: match.range(at: 1)) == prefixes.label {
        result.labelTitles.append(name)
        work.remove(range, as: .label(name))
    } else {
        result.projectTitle = name
        work.remove(range, as: .project(name))
    }
}

/// "remind day before at 9am" and the like (a Cria addition): cut before the date step so its "at 9am" is not read as
/// the due time.
private func cutReminders(_ work: inout QuickAddWorkingText, into result: inout QuickAddResult) {
    var found: [(range: NSRange, reminder: QuickAddReminder)] = []
    for match in quickAddMatches(reminderPhrasePattern, in: work.current) {
        let range = match.range(at: 1)
        if let reminder = parseReminderPhrase(work.current.substring(with: range)) { found.append((range, reminder)) }
    }
    result.reminders += found.map(\.reminder)
    for item in found.reversed() { work.remove(item.range, as: .reminder(item.reminder)) }
}

// MARK: Assembly

private func assemble(_ work: QuickAddWorkingText, into base: QuickAddResult) -> QuickAddResult {
    var result = base
    let raw = work.original
    let cuts = work.tokens.filter { !$0.inTitle }
    let marks = work.tokens.filter { token in token.inTitle && !cuts.contains { token.start < $0.end && token.end > $0.start } }
    var kept: [QuickAddToken] = []
    for token in (cuts + marks).sorted(by: { $0.start < $1.start }) where token.start >= (kept.last?.end ?? 0) {
        kept.append(token)
    }
    var title = ""
    var cursor = 0
    var walk = 0
    for item in kept {
        if !item.inTitle {
            if item.start > cursor { title += raw.substring(with: NSRange(location: cursor, length: item.start - cursor)) }
            cursor = item.end
        }
        if item.start > walk {
            let text = raw.substring(with: NSRange(location: walk, length: item.start - walk))
            result.tokens.append(QuickAddToken(kind: .text, start: walk, end: item.start, text: text))
        }
        result.tokens.append(item)
        walk = item.end
    }
    if cursor < raw.length { title += raw.substring(from: cursor) }
    if walk < raw.length {
        result.tokens.append(QuickAddToken(kind: .text, start: walk, end: raw.length, text: raw.substring(from: walk)))
    }
    result.title = title.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return result
}
