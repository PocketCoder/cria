import CriaKit
import SwiftUI

/// The small signals on a task row, as on Tauri's `TaskRowCore`: a paperclip when it has attachments, the checklist
/// count from the description, progress between 0 and 100%, a dot in the task's colour, and the repeat glyph. All of it
/// comes from the list snapshot (`TaskListItem`), so a row runs no query of its own.
struct TaskRowSignals: View {
    let item: TaskListItem
    /// Subtasks already show their own count, which is also the progress, so the percentage stays out.
    let hasSubtaskChip: Bool
    /// The due chip carries the repeat glyph already.
    let repeatShownByDue: Bool

    private var task: TaskRecord { item.task }

    private var percent: Int? {
        guard !hasSubtaskChip, task.percentDone > 0, task.percentDone < 1 else { return nil }
        return Int((task.percentDone * 100).rounded())
    }

    private var repeats: Bool { !repeatShownByDue && (task.repeatAfter > 0 || task.repeatMode != 0) }

    private var colour: Color? { Color(hexString: task.hexColor) }

    /// True when the row has any signal to show, so the metadata line is only drawn when it has something in it.
    static func hasAny(_ item: TaskListItem, hasSubtaskChip: Bool, repeatShownByDue: Bool) -> Bool {
        TaskRowSignals(item: item, hasSubtaskChip: hasSubtaskChip, repeatShownByDue: repeatShownByDue).isVisible
    }

    private var isVisible: Bool {
        item.hasAttachments || item.checklist.total > 0 || percent != nil || colour != nil || repeats
    }

    var body: some View {
        HStack(spacing: 6) {
            if let colour {
                Circle().fill(colour).frame(width: 10, height: 10)
                    .overlay(Circle().stroke(Color(.mutedForeground).opacity(0.35), lineWidth: 0.5))
                    .accessibilityHidden(true)
            }
            if item.hasAttachments {
                CriaChip(text: "", systemImage: "paperclip")
            }
            if item.checklist.total > 0 {
                let checklist = item.checklist
                CriaChip(
                    text: "\(checklist.checked)/\(checklist.total)", systemImage: "checklist",
                    tint: checklist.checked == checklist.total ? Color(.success) : Color(.mutedForeground)
                )
            }
            if let percent {
                CriaChip(text: "\(percent)%", systemImage: "chart.pie")
            }
            if repeats {
                CriaChip(text: "", systemImage: "repeat")
            }
        }
    }
}
