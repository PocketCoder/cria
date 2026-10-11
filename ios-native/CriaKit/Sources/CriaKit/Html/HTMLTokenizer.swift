import Foundation

struct HTMLAttribute: Equatable {
    var name: String
    var value: String?
}

enum HTMLToken: Equatable {
    case text(String)
    case start(name: String, attributes: [HTMLAttribute], selfClosing: Bool)
    case end(name: String)
}

/// A small forgiving HTML tokenizer. It only needs to feed `HTMLSanitizer`, so it drops
/// comments and doctype-like constructs and skips the body of raw-text elements.
struct HTMLTokenizer {
    private static let rawTextElements: Set<String> = ["script", "style", "textarea", "title"]

    private let chars: [Character]
    private var pos = 0

    init(_ html: String) {
        chars = Array(html)
    }

    mutating func tokens() -> [HTMLToken] {
        var result: [HTMLToken] = []
        while pos < chars.count {
            if chars[pos] == "<" {
                if let token = readMarkup() { result.append(token) }
            } else {
                result.append(.text(readText()))
            }
        }
        return result
    }

    private mutating func readText() -> String {
        var out = ""
        while pos < chars.count, chars[pos] != "<" {
            out.append(chars[pos])
            pos += 1
        }
        return out
    }

    private mutating func readMarkup() -> HTMLToken? {
        guard pos + 1 < chars.count else {
            pos += 1
            return .text("&lt;")
        }
        let next = chars[pos + 1]
        if next == "!" || next == "?" {
            skipDeclaration()
            return nil
        }
        if next == "/", pos + 2 < chars.count, chars[pos + 2].isLetter {
            return readEndTag()
        }
        if next.isLetter { return readStartTag() }
        pos += 1
        return .text("&lt;")
    }

    private mutating func skipDeclaration() {
        if matches("<!--", at: pos) {
            pos += 4
            while pos < chars.count, !matches("-->", at: pos) { pos += 1 }
            pos = min(pos + 3, chars.count)
            return
        }
        while pos < chars.count, chars[pos] != ">" { pos += 1 }
        pos = min(pos + 1, chars.count)
    }

    private mutating func readEndTag() -> HTMLToken {
        pos += 2
        let name = readName()
        while pos < chars.count, chars[pos] != ">" { pos += 1 }
        pos = min(pos + 1, chars.count)
        return .end(name: name)
    }

    private mutating func readStartTag() -> HTMLToken? {
        pos += 1
        let name = readName()
        var attributes: [HTMLAttribute] = []
        var selfClosing = false
        while pos < chars.count, chars[pos] != ">" {
            if chars[pos] == "/" {
                selfClosing = true
                pos += 1
            } else if chars[pos].isWhitespace {
                pos += 1
            } else {
                selfClosing = false
                attributes.append(readAttribute())
            }
        }
        pos = min(pos + 1, chars.count)
        if Self.rawTextElements.contains(name), !selfClosing { skipRawText(of: name) }
        return .start(name: name, attributes: attributes, selfClosing: selfClosing)
    }

    private mutating func readName() -> String {
        var name = ""
        while pos < chars.count, !chars[pos].isWhitespace, chars[pos] != "/", chars[pos] != ">" {
            name.append(chars[pos])
            pos += 1
        }
        return name.lowercased()
    }

    private mutating func readAttribute() -> HTMLAttribute {
        var name = ""
        while pos < chars.count, !chars[pos].isWhitespace, chars[pos] != "=", chars[pos] != ">", chars[pos] != "/" {
            name.append(chars[pos])
            pos += 1
        }
        skipSpaces()
        guard pos < chars.count, chars[pos] == "=" else {
            return HTMLAttribute(name: name.lowercased(), value: nil)
        }
        pos += 1
        skipSpaces()
        return HTMLAttribute(name: name.lowercased(), value: readAttributeValue())
    }

    private mutating func readAttributeValue() -> String {
        var value = ""
        guard pos < chars.count else { return value }
        let quote = chars[pos]
        if quote == "\"" || quote == "'" {
            pos += 1
            while pos < chars.count, chars[pos] != quote {
                value.append(chars[pos])
                pos += 1
            }
            pos = min(pos + 1, chars.count)
            return value
        }
        while pos < chars.count, !chars[pos].isWhitespace, chars[pos] != ">" {
            value.append(chars[pos])
            pos += 1
        }
        return value
    }

    private mutating func skipSpaces() {
        while pos < chars.count, chars[pos].isWhitespace { pos += 1 }
    }

    private mutating func skipRawText(of name: String) {
        let closing = "</" + name
        while pos < chars.count, !matches(closing, at: pos) { pos += 1 }
    }

    private func matches(_ literal: String, at index: Int) -> Bool {
        let wanted = Array(literal)
        guard index + wanted.count <= chars.count else { return false }
        for offset in 0..<wanted.count
        where chars[index + offset].lowercased() != String(wanted[offset]) {
            return false
        }
        return true
    }
}
