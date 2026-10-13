import Foundation

public enum HighlightKind: String, Equatable, Sendable {
    case field, `operator`, value, logical, paren, unknown
}

/// A coloured slice of the filter text. `start` and `end` are offsets into `Array(query)`.
public struct HighlightSpan: Equatable, Sendable {
    public let start: Int
    public let end: Int
    public let kind: HighlightKind
}

public let filterFields: [String] = [
    "done", "priority", "percentDone", "dueDate", "startDate", "endDate", "doneAt", "created", "updated",
    "labels", "assignees", "project", "reminders"
]

private let wordOperators: Set<String> = ["in", "like", "not"]

/// Position-tracking lexer for the Vikunja filter syntax, used to colour the filter editor. Separate from the
/// parser's tokenizer on purpose: this one never throws, and anything unrecognised is `.unknown`.
/// Ported from `highlightSpans` in `src/lib/filterHighlight.ts`.
public func highlightSpans(_ query: String) -> [HighlightSpan] {
    var lexer = HighlightLexer(chars: Array(query))
    lexer.run()
    return lexer.spans
}

private struct HighlightLexer {
    let chars: [Character]
    var spans: [HighlightSpan] = []
    var index = 0
    /// True at the start, and after `&&`, `||` or an open paren, so identifiers classify as fields there.
    var fieldPosition = true

    init(chars: [Character]) {
        self.chars = chars
    }

    private mutating func push(_ end: Int, _ kind: HighlightKind) {
        spans.append(HighlightSpan(start: index, end: end, kind: kind))
        index = end
    }

    private func has(_ text: String) -> Bool {
        let wanted = Array(text)
        return index + wanted.count <= chars.count && Array(chars[index..<(index + wanted.count)]) == wanted
    }

    mutating func run() {
        while index < chars.count {
            let char = chars[index]
            if char.isWhitespace {
                index += 1
            } else if "(),".contains(char) {
                let opens = char == "("
                push(index + 1, .paren)
                if opens { fieldPosition = true }
            } else if has("&&") || has("||") {
                push(index + 2, .logical)
                fieldPosition = true
            } else if has(">=") || has("<=") || has("!=") {
                push(index + 2, .operator)
                fieldPosition = false
            } else if "=<>".contains(char) {
                push(index + 1, .operator)
                fieldPosition = false
            } else if char == "'" || char == "\"" {
                quoted(char)
            } else if char.isASCII && char.isNumber {
                number()
            } else if char.isASCII && (char.isLetter || char == "_") {
                word()
            } else {
                push(index + 1, .unknown)
            }
        }
    }

    /// A string literal. An unterminated one runs to the end of the input.
    private mutating func quoted(_ quote: Character) {
        var cursor = index + 1
        while cursor < chars.count && chars[cursor] != quote { cursor += 1 }
        push(min(cursor + 1, chars.count), .value)
    }

    private mutating func number() {
        var cursor = index
        while cursor < chars.count && ((chars[cursor].isASCII && chars[cursor].isNumber) || chars[cursor] == ".") { cursor += 1 }
        push(cursor, .value)
    }

    private mutating func word() {
        var cursor = index
        while cursor < chars.count, chars[cursor].isASCII,
              chars[cursor].isLetter || chars[cursor].isNumber || "_/+-".contains(chars[cursor]) { cursor += 1 }
        let text = String(chars[index..<cursor])
        if wordOperators.contains(text.lowercased()) {
            push(cursor, .operator)
            fieldPosition = false
        } else if fieldPosition {
            push(cursor, filterFields.contains(text) ? .field : .unknown)
            fieldPosition = false
        } else {
            push(cursor, .value)
        }
    }
}

public enum AutocompleteKind: Equatable, Sendable {
    case field, label, project, assignee
}

public struct AutocompleteContext: Equatable, Sendable {
    public let kind: AutocompleteKind
    /// The partial word being typed, without any opening quote.
    public let prefix: String
    /// UTF-16 offset in the query where the replacement starts.
    public let replaceStart: Int
}

private let entityFields: [String: AutocompleteKind] = ["labels": .label, "project": .project, "assignees": .assignee]

private func firstCapture(_ pattern: String, in text: String, options: NSRegularExpression.Options = []) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
    let source = NSString(string: text)
    guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: source.length)) else { return nil }
    return (0..<match.numberOfRanges).map { group in
        let range = match.range(at: group)
        return range.location == NSNotFound ? "" : source.substring(with: range)
    }
}

/// What to suggest at `cursor` (a UTF-16 offset): field names at the start and after logical joins; label,
/// project or assignee values after those fields' operators; nil anywhere else.
public func autocompleteContext(_ query: String, cursor: Int) -> AutocompleteContext? {
    let source = NSString(string: query)
    let before = source.substring(to: min(cursor, source.length))
    let captures = firstCapture(#"(['"]?)([A-Za-z0-9_ ]*)$"#, in: before)
    let quote = captures?[1] ?? ""
    var prefix = captures?[2] ?? ""
    // A prefix with a space only makes sense inside quotes (multi-word titles).
    if quote.isEmpty && prefix.contains(" ") {
        prefix = firstCapture("([A-Za-z0-9_]*)$", in: before)?[1] ?? ""
    }
    let replaceStart = (before as NSString).length - prefix.utf16.count - quote.utf16.count
    let context = (before as NSString).substring(to: max(replaceStart, 0))
    if firstCapture(#"^\s*$"#, in: context) != nil || firstCapture(#"(\|\||&&|\()\s*$"#, in: context) != nil {
        return AutocompleteContext(kind: .field, prefix: prefix, replaceStart: replaceStart)
    }
    let value = firstCapture(
        #"([A-Za-z_]+)\s*(=|!=|like|in|not\s+in)\s*(?:[^&|()]*,)?\s*$"#, in: context, options: [.caseInsensitive]
    )
    if let field = value?[1], let kind = entityFields[field] {
        return AutocompleteContext(kind: kind, prefix: prefix, replaceStart: replaceStart)
    }
    return nil
}
