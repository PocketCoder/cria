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

    /// True when a description has words or an image in it. An editor's empty paragraph ("<p></p>") is not notes.
    /// For cards and their subtasks, which have no store-made summary to go by as rows do.
    static func hasNotes(_ html: String?) -> Bool {
        guard let html, !html.isEmpty else { return false }
        if html.contains("<img") { return true }
        let text = html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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

/// The quiet glyphs a subtask row inside a Mac card carries: due, repeat, comments and notes. Nothing when it has none.
struct MacSubtaskSignals: View {
    let task: TaskRecord
    @Environment(\.commentCounts) private var commentCounts
    @Environment(\.dateDisplay) private var dateDisplay

    private var comments: Int { task.serverId.flatMap { commentCounts[$0] } ?? 0 }
    private var repeats: Bool { task.repeatAfter > 0 || task.repeatMode != 0 }
    private var showsDue: Bool { task.dueDate != nil && !task.done }

    var isEmpty: Bool { !showsDue && !repeats && comments == 0 && !MacSignal.hasNotes(task.description) }

    var body: some View {
        if !isEmpty {
            HStack(spacing: 8) {
                if showsDue, let due = task.dueDate {
                    MacSignal(
                        systemImage: "calendar", text: DueDates.label(due, now: Date(), display: dateDisplay),
                        tint: DueDates.isOverdue(due, now: Date()) ? MacTheme.coral : MacTheme.label2
                    )
                }
                if repeats { MacSignal(systemImage: "repeat", spoken: "Repeats") }
                if comments > 0 {
                    MacSignal(systemImage: "bubble.left", text: "\(comments)", spoken: comments == 1 ? "1 comment" : "\(comments) comments")
                }
                if MacSignal.hasNotes(task.description) { MacSignal(systemImage: "text.alignleft", spoken: "Has notes") }
            }
            .font(.system(size: 10))
        }
    }
}
