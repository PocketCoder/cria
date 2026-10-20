import Foundation

/// The text the quick-add parser eats into. Vikunja-web parses by cutting each match out of the string and running the
/// next step on what is left; this does the same but remembers where every UTF-16 unit came from, so each cut-out
/// piece can be shown as a token over the text the person typed.
struct QuickAddWorkingText {
    let original: NSString
    private(set) var current: NSString
    /// `origin[i]` is the offset in `original` of the unit at `i` in `current`.
    private var origin: [Int]
    private(set) var tokens: [QuickAddToken] = []

    init(_ input: String) {
        original = NSString(string: input)
        current = original
        origin = Array(0..<original.length)
    }

    var string: String { current as String }
    var length: Int { current.length }

    /// Cuts `ranges` (offsets in `current`) out of the text; each run that stays contiguous in the original, less its
    /// edge whitespace, becomes a token of `kind`.
    mutating func remove(_ ranges: [NSRange], as kind: QuickAddTokenKind) {
        for range in ranges.sorted(by: { $0.location > $1.location }) where range.length > 0 {
            addTokens(for: range, kind: kind, inTitle: false)
            current = NSString(string: current.replacingCharacters(in: range, with: ""))
            origin.removeSubrange(range.location..<(range.location + range.length))
        }
    }

    mutating func remove(_ range: NSRange, as kind: QuickAddTokenKind) {
        remove([range], as: kind)
    }

    /// A token over text that stays in the title (Vikunja-web leaves `@name` in place).
    mutating func mark(_ range: NSRange, as kind: QuickAddTokenKind) {
        addTokens(for: range, kind: kind, inTitle: true)
    }

    var tokenCount: Int { tokens.count }

    /// Gives the tokens made since `index` their final kind (a date is only known once its time has been read too).
    mutating func retag(from index: Int, as kind: QuickAddTokenKind) {
        for position in index..<tokens.count {
            tokens[position] = QuickAddToken(
                kind: kind, start: tokens[position].start, end: tokens[position].end, text: tokens[position].text,
                inTitle: tokens[position].inTitle
            )
        }
    }

    private mutating func addTokens(for range: NSRange, kind: QuickAddTokenKind, inTitle: Bool) {
        guard range.length > 0, range.location + range.length <= origin.count else { return }
        var runStart = range.location
        var index = range.location
        let end = range.location + range.length
        while index < end {
            let next = index + 1
            if next == end || origin[next] != origin[index] + 1 {
                appendRun(from: runStart, through: index, kind: kind, inTitle: inTitle)
                runStart = next
            }
            index = next
        }
    }

    private mutating func appendRun(from first: Int, through last: Int, kind: QuickAddTokenKind, inTitle: Bool) {
        var start = origin[first]
        var end = origin[last] + 1
        while start < end, isSpace(original.character(at: start)) { start += 1 }
        while end > start, isSpace(original.character(at: end - 1)) { end -= 1 }
        guard end > start else { return }
        let text = original.substring(with: NSRange(location: start, length: end - start))
        tokens.append(QuickAddToken(kind: kind, start: start, end: end, text: text, inTitle: inTitle))
    }

    private func isSpace(_ unit: unichar) -> Bool {
        Unicode.Scalar(unit).map { CharacterSet.whitespacesAndNewlines.contains($0) } ?? false
    }
}

/// Matches of `pattern` in `text` (case-insensitive unless told otherwise).
func quickAddMatches(
    _ pattern: String, in text: NSString, caseInsensitive: Bool = true, from offset: Int = 0
) -> [NSTextCheckingResult] {
    let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
    guard let regex = RegexCache.regex(pattern, options: options), offset <= text.length else { return [] }
    return regex.matches(in: text as String, range: NSRange(location: offset, length: text.length - offset))
}

func quickAddFirstMatch(_ pattern: String, in text: NSString, caseInsensitive: Bool = true) -> NSTextCheckingResult? {
    quickAddMatches(pattern, in: text, caseInsensitive: caseInsensitive).first
}
