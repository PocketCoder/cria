import Foundation

public enum FilterOperator: String, Equatable, Sendable {
    case equal = "="
    case notEqual = "!="
    case greater = ">"
    case greaterOrEqual = ">="
    case less = "<"
    case lessOrEqual = "<="
    case like
    case inList = "in"
    case notInList = "not in"
}

public enum FilterLogic: String, Equatable, Sendable {
    case conjunction = "&&"
    case disjunction = "||"
}

public indirect enum FilterValue: Equatable, Sendable {
    case number(Double)
    case boolean(Bool)
    case string(String)
    case dateMath(value: String, resolved: String)
    case array([FilterValue])
}

public struct FilterClause: Equatable, Sendable {
    public let field: String
    public let comparison: FilterOperator
    public let value: FilterValue
}

public struct FilterGroup: Equatable, Sendable {
    public let logic: FilterLogic
    public let children: [FilterNode]
}

public indirect enum FilterNode: Equatable, Sendable {
    case clause(FilterClause)
    case group(FilterGroup)
}

public struct FilterQuery: Equatable, Sendable {
    public let ast: FilterNode?
    public let includeNulls: Bool
}

public struct FilterParseError: Error, Equatable, Sendable, CustomStringConvertible {
    public let message: String
    public var description: String { message }
}

/// Parses Vikunja filter syntax (`done = false && priority >= 3`). Empty input gives a nil AST.
/// Date math (`now+1d`) resolves against `now` in `calendar`'s time zone. Like the TypeScript parser,
/// tokens after a complete expression are ignored.
public func parseFilterQuery(_ input: String, now: Date = Date(), calendar: Calendar = .current) throws -> FilterQuery {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return FilterQuery(ast: nil, includeNulls: false) }
    var tokenizer = FilterTokenizer(chars: Array(trimmed))
    let tokens = try tokenizer.tokenize()
    guard !tokens.isEmpty else { return FilterQuery(ast: nil, includeNulls: false) }
    var parser = FilterExpressionParser(tokens: tokens, now: now, calendar: calendar)
    return FilterQuery(ast: try parser.parseExpression(), includeNulls: false)
}

// MARK: - Tokenizer

enum FilterTokenKind: String {
    case lparen = "LPAREN"
    case rparen = "RPAREN"
    case andSign = "AND"
    case orSign = "OR"
    case comma = "COMMA"
    case comparison = "OP"
    case number = "NUMBER"
    case boolean = "BOOLEAN"
    case string = "STRING"
    case ident = "IDENT"
    case dateMath = "DATE_MATH"
}

struct FilterToken: Equatable, Sendable {
    let kind: FilterTokenKind
    let value: String
}

private let twoCharTokens: [String: FilterToken] = [
    "&&": FilterToken(kind: .andSign, value: "&&"),
    "||": FilterToken(kind: .orSign, value: "||"),
    "!=": FilterToken(kind: .comparison, value: "!="),
    ">=": FilterToken(kind: .comparison, value: ">="),
    "<=": FilterToken(kind: .comparison, value: "<=")
]

private let oneCharTokens: [Character: FilterToken] = [
    "(": FilterToken(kind: .lparen, value: "("),
    ")": FilterToken(kind: .rparen, value: ")"),
    ",": FilterToken(kind: .comma, value: ","),
    "=": FilterToken(kind: .comparison, value: "="),
    ">": FilterToken(kind: .comparison, value: ">"),
    "<": FilterToken(kind: .comparison, value: "<")
]

private func isDigit(_ char: Character?) -> Bool {
    guard let char else { return false }
    return char.isASCII && char.isNumber
}

private func isAsciiLetter(_ char: Character?) -> Bool {
    guard let char else { return false }
    return char.isASCII && char.isLetter
}

private func isWordCharacter(_ char: Character?) -> Bool {
    guard let char else { return false }
    return isAsciiLetter(char) || isDigit(char) || char == "_" || char == "%"
}

struct FilterTokenizer {
    let chars: [Character]
    private var index = 0

    init(chars: [Character]) {
        self.chars = chars
    }

    private func peek(_ offset: Int = 0) -> Character? {
        let position = index + offset
        return position < chars.count ? chars[position] : nil
    }

    private mutating func skipWhitespace() {
        while let char = peek(), char.isWhitespace {
            index += 1
        }
    }

    private func isNumberStart(_ current: Character) -> Bool {
        isDigit(current) || (current == "." && isDigit(peek(1)))
    }

    private func isQuote(_ current: Character) -> Bool {
        current == "\"" || current == "'"
    }

    private func isWordStart(_ current: Character) -> Bool {
        current == "%" || current == "_" || isAsciiLetter(current)
    }

    mutating func tokenize() throws -> [FilterToken] {
        var tokens: [FilterToken] = []
        while index < chars.count {
            skipWhitespace()
            guard let current = peek() else { break }
            if let next = peek(1), let token = twoCharTokens[String([current, next])] {
                tokens.append(token)
                index += 2
            } else if let token = oneCharTokens[current] {
                tokens.append(token)
                index += 1
            } else if isNumberStart(current) {
                tokens.append(scanNumber())
            } else if isQuote(current) {
                tokens.append(scanString(quote: current))
            } else if isWordStart(current) {
                tokens.append(scanWord())
            } else {
                throw FilterParseError(message: "Unexpected character '\(current)' at position \(index)")
            }
        }
        return tokens
    }

    private mutating func scanDigits(into text: inout String) {
        while let char = peek(), isDigit(char) {
            text.append(char)
            index += 1
        }
    }

    private mutating func scanNumber() -> FilterToken {
        var number = ""
        scanDigits(into: &number)
        if peek() == "." {
            number.append(".")
            index += 1
            scanDigits(into: &number)
        }
        return FilterToken(kind: .number, value: number)
    }

    private mutating func scanString(quote: Character) -> FilterToken {
        index += 1
        var text = ""
        while let char = peek(), char != quote {
            index += 1
            if char == "\\" {
                if let escaped = peek() {
                    text.append(escaped)
                    index += 1
                }
            } else {
                text.append(char)
            }
        }
        if index < chars.count {
            index += 1
        }
        return FilterToken(kind: .string, value: text)
    }

    private mutating func scanWord() -> FilterToken {
        var word = ""
        while let char = peek(), isWordCharacter(char) {
            word.append(char)
            index += 1
        }
        switch word.lowercased() {
        case "true", "false":
            return FilterToken(kind: .boolean, value: word.lowercased())
        case "like":
            return FilterToken(kind: .comparison, value: "like")
        case "in":
            return FilterToken(kind: .comparison, value: "in")
        case "not":
            return scanNot(word)
        case "now":
            return scanNow()
        default:
            return FilterToken(kind: .ident, value: word)
        }
    }

    private mutating func scanNot(_ word: String) -> FilterToken {
        skipWhitespace()
        if peek() == "i", peek(1) == "n", !isWordCharacter(peek(2)) || peek(2) == "%" {
            index += 2
            return FilterToken(kind: .comparison, value: "not in")
        }
        return FilterToken(kind: .ident, value: word)
    }

    private mutating func scanNow() -> FilterToken {
        guard let sign = peek(), sign == "+" || sign == "-" else {
            return FilterToken(kind: .dateMath, value: "now")
        }
        var offset = String(sign)
        index += 1
        scanDigits(into: &offset)
        if let unit = peek(), "dwmy".contains(unit) {
            offset.append(unit)
            index += 1
        }
        return FilterToken(kind: .dateMath, value: "now" + offset)
    }
}

// MARK: - Date math

private func resolveDateMath(_ value: String, now: Date, calendar: Calendar) -> String {
    let fallback = QueryDates.isoString(now)
    let rest = value.dropFirst(3)
    guard let sign = rest.first, sign == "+" || sign == "-", let unit = rest.last, "dwmy".contains(unit) else {
        return fallback
    }
    let digits = rest.dropFirst().dropLast()
    guard !digits.isEmpty, digits.allSatisfy({ isDigit($0) }), let magnitude = Int(digits) else {
        return fallback
    }
    let amount = sign == "+" ? magnitude : -magnitude
    var parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second, .nanosecond], from: now)
    switch unit {
    case "d":
        parts.day = (parts.day ?? 0) + amount
    case "w":
        parts.day = (parts.day ?? 0) + amount * 7
    case "m":
        parts.month = (parts.month ?? 0) + amount
    default:
        parts.year = (parts.year ?? 0) + amount
    }
    return QueryDates.isoString(calendar.date(from: parts) ?? now)
}

// MARK: - Parser

struct FilterExpressionParser {
    let tokens: [FilterToken]
    let now: Date
    let calendar: Calendar
    private var position = 0

    init(tokens: [FilterToken], now: Date, calendar: Calendar) {
        self.tokens = tokens
        self.now = now
        self.calendar = calendar
    }

    private func peek() -> FilterToken? {
        position < tokens.count ? tokens[position] : nil
    }

    private mutating func consume() throws -> FilterToken {
        guard let token = peek() else { throw FilterParseError(message: "Unexpected end of input") }
        position += 1
        return token
    }

    private mutating func expect(_ kind: FilterTokenKind) throws -> FilterToken {
        guard let token = peek(), token.kind == kind else {
            let got = peek().map { "\($0.kind.rawValue)(\($0.value))" } ?? "EOF"
            throw FilterParseError(message: "Expected \(kind.rawValue), got \(got)")
        }
        return try consume()
    }

    mutating func parseExpression() throws -> FilterNode {
        var left = try parseTerm()
        while peek()?.kind == .orSign {
            _ = try consume()
            let right = try parseTerm()
            left = .group(FilterGroup(logic: .disjunction, children: [left, right]))
        }
        return left
    }

    private mutating func parseTerm() throws -> FilterNode {
        var left = try parseFactor()
        while peek()?.kind == .andSign {
            _ = try consume()
            let right = try parseFactor()
            left = .group(FilterGroup(logic: .conjunction, children: [left, right]))
        }
        return left
    }

    private mutating func parseFactor() throws -> FilterNode {
        if peek()?.kind == .lparen {
            _ = try consume()
            let expression = try parseExpression()
            _ = try expect(.rparen)
            return expression
        }
        return .clause(try parseClause())
    }

    private mutating func parseClause() throws -> FilterClause {
        let field = try expect(.ident)
        let opToken = try expect(.comparison)
        guard let comparison = FilterOperator(rawValue: opToken.value) else {
            throw FilterParseError(message: "Unknown operator \(opToken.value)")
        }
        var values = [try parseValue()]
        let isList = comparison == .inList || comparison == .notInList
        while isList, peek()?.kind == .comma {
            _ = try consume()
            values.append(try parseValue())
        }
        return FilterClause(
            field: field.value,
            comparison: comparison,
            value: values.count == 1 ? values[0] : .array(values)
        )
    }

    private mutating func parseValue() throws -> FilterValue {
        guard let token = peek() else { throw FilterParseError(message: "Expected a value") }
        let value: FilterValue
        switch token.kind {
        case .number:
            guard let number = Double(Self.normalisedNumber(token.value)) else {
                throw FilterParseError(message: "Invalid number \(token.value)")
            }
            value = .number(number)
        case .boolean:
            value = .boolean(token.value == "true")
        case .string, .ident:
            value = .string(token.value)
        case .dateMath:
            value = .dateMath(value: token.value, resolved: resolveDateMath(token.value, now: now, calendar: calendar))
        default:
            throw FilterParseError(message: "Unexpected token \(token.kind.rawValue)(\(token.value)) when expecting a value")
        }
        _ = try consume()
        return value
    }

    /// Makes `4.` and `.5` parseable by `Double`, which JavaScript's `parseFloat` accepts.
    private static func normalisedNumber(_ text: String) -> String {
        var result = text
        if result.hasPrefix(".") {
            result = "0" + result
        }
        if result.hasSuffix(".") {
            result += "0"
        }
        return result
    }
}
