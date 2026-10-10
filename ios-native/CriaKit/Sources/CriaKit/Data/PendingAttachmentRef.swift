import Foundation

/// Placeholder `<img>` source for an image whose upload is still queued: `cria://pending/{attachmentLocalId}`.
/// Ported from `src/lib/pendingAttachmentRef.ts`. Matching stops at the end of the id, so one id that happens to
/// prefix another is never rewritten by mistake.
enum PendingAttachmentRef {
    static let prefix = "cria://pending/"
    private static let refPattern = "cria://pending/([A-Za-z0-9_-]+)"
    private static let imagePattern = #"<img\b(?:[^>"']|"[^"]*"|'[^']*')*>"#

    static func ref(_ attachmentLocalId: String) -> String {
        prefix + attachmentLocalId
    }

    /// Replaces every reference to `attachmentLocalId` with `url`.
    static func replace(in html: String, attachmentLocalId: String, with url: String) -> String {
        rewrite(html, pattern: refPattern) { matched in
            String(matched.dropFirst(prefix.count)) == attachmentLocalId ? url : nil
        }
    }

    /// Removes every `<img>` that points at the pending reference (its upload was cancelled). If nothing else is
    /// left, returns `<p></p>` rather than an empty string, as Vikunja rejects an empty comment. Returns `html`
    /// itself when nothing matched.
    static func stripImages(in html: String, attachmentLocalId: String) -> String {
        guard html.contains(prefix) else { return html }
        var removed = false
        let stripped = rewrite(html, pattern: imagePattern, options: [.caseInsensitive]) { tag in
            guard refersTo(tag, attachmentLocalId: attachmentLocalId) else { return nil }
            removed = true
            return ""
        }
        guard removed else { return html }
        return stripped.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "<p></p>" : stripped
    }

    private static func refersTo(_ tag: String, attachmentLocalId: String) -> Bool {
        matches(in: tag, pattern: refPattern).contains { range in
            String(tag[range].dropFirst(prefix.count)) == attachmentLocalId
        }
    }

    private static func matches(
        in text: String, pattern: String, options: NSRegularExpression.Options = []
    ) -> [Range<String.Index>] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let whole = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: whole).compactMap { Range($0.range, in: text) }
    }

    /// Replaces each match with the transform's result, or keeps it when the transform returns nil.
    private static func rewrite(
        _ text: String, pattern: String, options: NSRegularExpression.Options = [], transform: (String) -> String?
    ) -> String {
        var output = ""
        var cursor = text.startIndex
        for range in matches(in: text, pattern: pattern, options: options) {
            output += text[cursor..<range.lowerBound]
            let matched = String(text[range])
            output += transform(matched) ?? matched
            cursor = range.upperBound
        }
        output += text[cursor...]
        return output
    }
}
