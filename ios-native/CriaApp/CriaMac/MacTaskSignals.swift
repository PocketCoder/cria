import CriaKit
import SwiftUI

/// What a Mac row or card says about a task before it is opened: one quiet grey line of glyphs, with a count where
/// there is one. The order is fixed so the eye learns it: subtasks, due date, repeat, checklist, notes, attachments,
/// then labels. Only an overdue date takes colour (coral).
struct MacSignal: View {
    let systemImage: String
    var text: String?
    var tint: Color = MacTheme.label2
    /// Read instead of the glyph: "1 of 3 subtasks done".
    var spoken: String?

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: systemImage)
            if let text { Text(text).monospacedDigit() }
        }
        .foregroundStyle(tint)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken ?? text ?? "")
    }

    /// "1/3" subtasks done, with the indented-list glyph.
    static func subtasks(done: Int, total: Int) -> MacSignal {
        MacSignal(systemImage: "list.bullet.indent", text: "\(done)/\(total)", spoken: "\(done) of \(total) subtasks done")
    }
}

/// A label as a grey chip: a tag in the label's muted colour, then its title.
struct MacLabelTag: View {
    let label: LabelRecord

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "tag").foregroundStyle(MacTheme.projectColour(hex: label.hexColor))
            Text(label.title).foregroundStyle(MacTheme.label2)
        }
        .font(.system(size: 11, weight: .medium))
        .padding(.horizontal, 7)
        .frame(height: 18)
        .background(MacTheme.fill, in: Capsule())
    }
}
