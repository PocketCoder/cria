import Foundation

/// The few character references TipTap output uses, plus numeric ones.
enum HTMLEntities {
    private static let named = [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&apos;", "'"), ("&nbsp;", "\u{00A0}")]

    static func decode(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var result = decodeNumeric(text)
        for (entity, value) in named {
            result = result.replacingOccurrences(of: entity, with: value)
        }
        return result.replacingOccurrences(of: "&amp;", with: "&")
    }

    private static func decodeNumeric(_ text: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: "&#(x?[0-9a-fA-F]+);") else { return text }
        var result = text
        let range = NSRange(text.startIndex..., in: text)
        for match in regex.matches(in: text, range: range).reversed() {
            guard let whole = Range(match.range, in: result), let digits = Range(match.range(at: 1), in: result) else { continue }
            let code = String(result[digits])
            let value = code.hasPrefix("x") ? UInt32(code.dropFirst(), radix: 16) : UInt32(code)
            guard let value, let scalar = Unicode.Scalar(value) else { continue }
            result.replaceSubrange(whole, with: String(Character(scalar)))
        }
        return result
    }

    static func encode(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    static func encodeAttribute(_ text: String) -> String {
        encode(text).replacingOccurrences(of: "\"", with: "&quot;")
    }
}
