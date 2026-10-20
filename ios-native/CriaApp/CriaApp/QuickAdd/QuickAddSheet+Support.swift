import CriaKit
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

extension QuickAddSheet {
    /// The chips for what the typed line sets that no picker holds: a repeat (and whether it counts from completion)
    /// and, with the expanded syntax, the end date from `{deadline}`, `9-10am` or `for 1h`.
    @ViewBuilder var parsedChips: some View {
        let result = parsed
        if result.repeatAfter != nil || result.repeatMode != nil {
            CriaChip(
                text: result.repeatMode == 2 ? "Repeats after done" : "Repeats", systemImage: "repeat",
                tint: Color(.mutedForeground)
            )
        }
        if let end = result.endDate {
            CriaChip(
                text: "Ends " + DueDates.label(end, now: Date(), display: dateDisplay), systemImage: "flag.checkered",
                tint: Color(.sky700)
            )
        }
    }
}

enum QuickAddFocus: Hashable {
    case title, description, subtask
}
