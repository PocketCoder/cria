import Foundation

/// Allow-list sanitiser for Vikunja descriptions and comments. Port of `src/lib/sanitize.ts`
/// (DOMPurify config plus the anchor hardening hook), without a DOM: it tokenises, filters
/// and re-serialises. Text is passed through as written; attribute values are re-quoted.
public enum HTMLSanitizer {
    static let allowedTags: Set<String> = [
        "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
        "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
        "hr", "span", "img", "input", "label", "mention-user"
    ]
    static let voidTags: Set<String> = ["br", "hr", "img", "input"]
    static let droppedContent: Set<String> = [
        "script", "style", "iframe", "noscript", "template", "object", "embed", "textarea", "title", "select"
    ]
    static let allowedAttributes: Set<String> = [
        "href", "title", "class", "rel", "target", "src", "alt", "type", "checked",
        "data-type", "data-src", "data-checked", "data-id"
    ]
    static let mentionTag = "mention-user"

    public static func sanitize(_ html: String) -> String {
        var tokenizer = HTMLTokenizer(html)
        var writer = SanitizerWriter()
        for token in tokenizer.tokens() { writer.consume(token) }
        return writer.finish()
    }

    /// The `ALLOWED_URI_REGEXP` from the TypeScript config, applied to a lowercased value.
    private static let uriPattern = "^(?:(?:https?|mailto):|cria://pending/|#|/|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))"
    private static let linkPattern = "^(?:https?:|mailto:|#|/)"

    static func isSafeValue(_ value: String) -> Bool {
        let stripped = String(String.UnicodeScalarView(value.unicodeScalars.filter { !isStrippable($0) }))
        if stripped.isEmpty { return true }
        return matches(uriPattern, stripped.lowercased())
    }

    static func isSafeLink(_ href: String) -> Bool {
        matches(linkPattern, href.lowercased())
    }

    private static func matches(_ pattern: String, _ text: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
        let range = NSRange(text.startIndex..., in: text)
        return regex.firstMatch(in: text, range: range) != nil
    }

    private static func isStrippable(_ scalar: Unicode.Scalar) -> Bool {
        let code = scalar.value
        return code <= 0x20 || code == 0xA0 || code == 0x1680 || code == 0x180E
            || (0x2000...0x2029).contains(code) || code == 0x205F || code == 0x3000
    }

    static func cleanAttributes(tag: String, attributes: [HTMLAttribute]) -> [HTMLAttribute] {
        var kept: [HTMLAttribute] = []
        for attribute in attributes {
            guard allowedAttributes.contains(attribute.name) else { continue }
            if tag == mentionTag, attribute.name != "data-id" { continue }
            guard isSafeValue(attribute.value ?? "") else { continue }
            if tag == "a", attribute.name == "href", !isSafeLink((attribute.value ?? "").trimmingCharacters(in: .whitespaces)) {
                continue
            }
            kept.append(attribute)
        }
        if tag == "a" {
            kept.removeAll { $0.name == "target" || $0.name == "rel" }
            kept.append(HTMLAttribute(name: "target", value: "_blank"))
            kept.append(HTMLAttribute(name: "rel", value: "noopener noreferrer"))
        }
        return kept
    }
}

struct SanitizerWriter {
    private var output = ""
    private var openTags: [String] = []
    private var skipping: String?

    mutating func consume(_ token: HTMLToken) {
        if let skipName = skipping {
            if case .end(let name) = token, name == skipName { skipping = nil }
            return
        }
        switch token {
        case .text(let text):
            output += text
        case .start(let name, let attributes, let selfClosing):
            open(name: name, attributes: attributes, selfClosing: selfClosing)
        case .end(let name):
            close(name: name)
        }
    }

    mutating func finish() -> String {
        while let name = openTags.popLast() { output += "</\(name)>" }
        return output
    }

    private mutating func open(name: String, attributes: [HTMLAttribute], selfClosing: Bool) {
        if HTMLSanitizer.droppedContent.contains(name) {
            if !selfClosing { skipping = name }
            return
        }
        guard HTMLSanitizer.allowedTags.contains(name) else { return }
        output += "<" + name
        for attribute in HTMLSanitizer.cleanAttributes(tag: name, attributes: attributes) {
            let escaped = (attribute.value ?? "").replacingOccurrences(of: "\"", with: "&quot;")
            output += " \(attribute.name)=\"\(escaped)\""
        }
        output += ">"
        if !HTMLSanitizer.voidTags.contains(name) { openTags.append(name) }
    }

    private mutating func close(name: String) {
        guard let index = openTags.lastIndex(of: name) else { return }
        while openTags.count > index, let top = openTags.popLast() {
            output += "</\(top)>"
        }
    }
}
