import SwiftUI

extension QuickAddSheet {
    /// Plain text as a paragraph, escaped, with line breaks kept.
    static func paragraphHTML(_ text: String) -> String {
        let escaped = text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\n", with: "<br>")
        return "<p>\(escaped)</p>"
    }
}

enum QuickAddFocus: Hashable {
    case title, description, subtask
}
