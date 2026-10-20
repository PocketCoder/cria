import Foundation

// The symbol steps of Quick Add Magic (labels, project, priority, assignees, repeats), ported from Vikunja-web's
// `prefixParser.ts`, `priorityParser.ts`, `repeatParser.ts` and `textCleanup.ts`. Names run from just after the prefix
// to the next space, or between a pair of quotes. Differences from upstream, all on purpose:
//
// - Curly quotes (what iOS Smart Punctuation and macOS smart quotes type) open and close a quoted name like straight ones.
// - Removing a bare name needs a space or the end after it, so `*work` no longer eats the start of `*workout`.
// - The repeat words are matched in any case ("Daily"); upstream only reads the lower-case spelling right.

private let singleQuotes: Set<Character> = ["'", "\u{2018}", "\u{2019}"]
private let doubleQuotes: Set<Character> = ["\"", "\u{201C}", "\u{201D}"]
private let singleClass = "['\u{2018}\u{2019}]"
private let doubleClass = "[\"\u{201C}\u{201D}]"

/// The names written after `prefix`, each once, in order (`getItemsFromPrefix`).
func quickAddItems(in text: String, prefix: String) -> [String] {
    let parts = text.components(separatedBy: " " + prefix)
    var items: [String] = []
    for (index, raw) in parts.enumerated() {
        if index == 0, !text.hasPrefix(prefix) { continue }
        var part = Substring(raw)
        if part.hasPrefix(prefix) { part = part.dropFirst(prefix.count) }
        guard let item = itemText(part), !item.isEmpty, !items.contains(item) else { continue }
        items.append(item)
    }
    return items
}

/// The name at the start of `part`: a quoted run, else up to the next space. Nil for a quote that never closes.
private func itemText(_ part: Substring) -> String? {
    guard let first = part.first else { return "" }
    for quotes in [singleQuotes, doubleQuotes] where quotes.contains(first) {
        let pieces = part.split(omittingEmptySubsequences: false) { quotes.contains($0) }
        return pieces.count > 1 ? String(pieces[1]) : nil
    }
    return String(part.prefix { $0 != " " })
}

/// The patterns that cut one name and its prefix out of the text, longest form first (`cleanupItemText`). The space
/// after a name goes with it.
private func removalPatterns(_ item: String, prefix: String, exact: Bool) -> [String] {
    let lead = NSRegularExpression.escapedPattern(for: prefix)
    let name = NSRegularExpression.escapedPattern(for: item)
    let bareEnd = exact ? #"(?=\s|$)"# : ""
    return [
        lead + singleClass + name + singleClass + " ", lead + singleClass + name + singleClass,
        lead + doubleClass + name + doubleClass + " ", lead + doubleClass + name + doubleClass,
        lead + name + " ", lead + name + bareEnd
    ]
}

/// Cuts every written form of `item` out of the text as tokens of `kind`.
func quickAddCut(
    _ item: String, prefix: String, as kind: QuickAddTokenKind, exact: Bool = true, from work: inout QuickAddWorkingText
) {
    for pattern in removalPatterns(item, prefix: prefix, exact: exact) {
        work.remove(quickAddMatches(pattern, in: work.current).map(\.range), as: kind)
    }
}

/// Marks each written form of an assignee in place; the title keeps the text.
func quickAddMarkAssignee(_ item: String, prefix: String, in work: inout QuickAddWorkingText) {
    let lead = NSRegularExpression.escapedPattern(for: prefix)
    let name = NSRegularExpression.escapedPattern(for: item)
    let pattern = #"(?:^|\s)("# + lead + "(?:" + singleClass + name + singleClass + "|" + doubleClass + name + doubleClass
        + "|" + name + "))" + #"(?=\s|$)"#
    for match in quickAddMatches(pattern, in: work.current, caseInsensitive: false) {
        work.mark(match.range(at: 1), as: .assignee(item))
    }
}

/// The first priority written after `prefix` that Vikunja has (0 to 5). `!2abc` reads as 2, as upstream.
func quickAddPriority(in text: String, prefix: String) -> Int? {
    for item in quickAddItems(in: text, prefix: prefix) {
        let digits = item.prefix { $0.isASCII && $0.isNumber }
        if let value = Int(digits), (0...5).contains(value) { return value }
    }
    return nil
}

// MARK: Repeats

private let repeatPattern = #"(^| )(((every|each) (([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten) )?"#
    + #"(hours?|days?|weeks?|months?|years?))|(annually|biannually|semiannually|biennially|daily|hourly|monthly|weekly|yearly))($| )"#

private let numberWords = ["one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10]
private let secondsPerUnit: [String: Int] = ["day": 86_400, "week": 604_800, "month": 2_592_000, "year": 31_536_000, "hour": 3_600]
private let keywordRepeats: [String: (amount: Int, unit: String)] = [
    "annually": (1, "year"), "yearly": (1, "year"), "biennially": (2, "year"), "biannually": (6, "month"),
    "semiannually": (6, "month"), "daily": (1, "day"), "hourly": (1, "hour"), "monthly": (1, "month"), "weekly": (1, "week")
]

/// What a repeat phrase sets on the task: `repeat_after` seconds and `repeat_mode` (1 is Vikunja's monthly mode).
struct QuickAddRepeat: Equatable {
    let after: Int?
    let mode: Int?
}

/// "every 2 weeks", "each month", "daily", "biannually". A single month is Vikunja's monthly mode (it ignores
/// repeat_after); "every N months" (N > 1) is approximated as N x 30 days rather than dropping the N.
func quickAddRepeat(amount: Int, unit: String) -> QuickAddRepeat? {
    guard amount > 0, let seconds = secondsPerUnit[unit] else { return nil }
    if unit == "month", amount == 1 { return QuickAddRepeat(after: nil, mode: 1) }
    // A huge number must not trap the multiplication: this runs on every keystroke.
    let (product, overflow) = amount.multipliedReportingOverflow(by: seconds)
    return overflow ? nil : QuickAddRepeat(after: product, mode: 0)
}

/// Cuts the first repeat phrase out of the text. Returns what it asks for.
func quickAddCutRepeat(from work: inout QuickAddWorkingText) -> QuickAddRepeat? {
    guard let match = quickAddFirstMatch(repeatPattern, in: work.current),
          let repeats = repeatFromMatch(match, in: work.current) else { return nil }
    let tail = match.range(at: 9).length
    let range = NSRange(location: match.range.location, length: match.range.length - tail)
    work.remove(range, as: .recurrence(repeatAfter: repeats.after, repeatMode: repeats.mode))
    return repeats
}

private func repeatFromMatch(_ match: NSTextCheckingResult, in text: NSString) -> QuickAddRepeat? {
    func group(_ index: Int) -> String? {
        match.range(at: index).location == NSNotFound ? nil : text.substring(with: match.range(at: index)).lowercased()
    }
    if let keyword = group(8), let entry = keywordRepeats[keyword] {
        return quickAddRepeat(amount: entry.amount, unit: entry.unit)
    }
    guard var unit = group(7) else { return nil }
    if unit.hasSuffix("s") { unit.removeLast() }
    var amount = 1
    if let word = group(6) {
        guard let value = numberWords[word] ?? Int(word) else { return nil }
        amount = value
    }
    return quickAddRepeat(amount: amount, unit: unit)
}
