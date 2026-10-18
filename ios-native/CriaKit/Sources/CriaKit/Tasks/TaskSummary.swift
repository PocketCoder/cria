import Foundation

/// A description as one short plain line for a list row: tags stripped, entities decoded, every run of whitespace
/// and line break collapsed to one space. Only the head of the HTML is read, as a list may hold hundreds of rows.
public enum TaskSummary {
    public static func line(_ html: String?, maxLength: Int = 140) -> String? {
        guard let html, !html.isEmpty else { return nil }
        var head = String(html.prefix(maxLength * 6))
        // The cut can land inside a tag, which the stripper would then leave as text.
        if let open = head.lastIndex(of: "<"), !head[open...].contains(">") { head = String(head[..<open]) }
        let words = AIPrompts.stripHtml(head).split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        guard !words.isEmpty else { return nil }
        let text = words.joined(separator: " ")
        guard text.count > maxLength else { return text }
        return String(text.prefix(maxLength - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }
}
