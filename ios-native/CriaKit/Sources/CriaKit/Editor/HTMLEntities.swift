import Foundation

/// The character references TipTap and Vikunja output use, plus numeric ones. Decoding is one left-to-right pass, so
/// `&#38;lt;` becomes the text `&lt;` and is not decoded a second time.
enum HTMLEntities {
    private static let named: [String: String] = [
        "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "amp": "&", "nbsp": "\u{00A0}",
        "mdash": "\u{2014}", "ndash": "\u{2013}", "hellip": "\u{2026}", "copy": "\u{00A9}",
        "lsquo": "\u{2018}", "rsquo": "\u{2019}", "ldquo": "\u{201C}", "rdquo": "\u{201D}",
        "laquo": "\u{00AB}", "raquo": "\u{00BB}", "middot": "\u{00B7}", "bull": "\u{2022}"
    ]
    private static let longestReference = 10

    static func decode(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var result = ""
        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            guard character == "&", let (value, next) = reference(in: text, at: index) else {
                result.append(character)
                index = text.index(after: index)
                continue
            }
            result += value
            index = next
        }
        return result
    }

    /// The decoded value and the index after the `;`, or nil when `&` does not start a known reference.
    private static func reference(in text: String, at start: String.Index) -> (String, String.Index)? {
        let body = text[text.index(after: start)...].prefix(longestReference + 1)
        guard let semicolon = body.firstIndex(of: ";") else { return nil }
        let name = String(body[..<semicolon])
        let next = text.index(after: semicolon)
        if let value = named[name] { return (value, next) }
        guard name.hasPrefix("#") else { return nil }
        let digits = name.dropFirst()
        let hex = digits.hasPrefix("x") || digits.hasPrefix("X")
        let number = hex ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits, radix: 10)
        guard let number, number != 0, let scalar = Unicode.Scalar(number) else { return nil }
        return (String(Character(scalar)), next)
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
