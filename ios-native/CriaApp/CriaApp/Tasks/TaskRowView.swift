import CriaKit
import SwiftUI

/// One task row: completion circle, title, then a metadata line of due date, labels and project.
struct TaskRowView: View {
    let item: TaskListItem
    var showProject = false
    let onToggle: () -> Void

    private var task: TaskRecord { item.task }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CheckCircle(isDone: task.done, action: onToggle)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    PriorityDot(level: task.priority)
                    Text(task.title)
                        .font(Theme.rowTitle)
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                    if task.isFavorite {
                        Image(systemName: "star.fill").font(Theme.footnote).foregroundStyle(Color(.warning))
                    }
                }
                metadata
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var metadata: some View {
        let due = task.dueDate
        let chips = item.labels.count + (showProject && item.projectTitle != nil ? 1 : 0) + (due == nil ? 0 : 1)
        if chips > 0 {
            HStack(spacing: 6) {
                if let due {
                    let overdue = !task.done && DueDates.isOverdue(due, now: Date())
                    CriaChip(
                        text: DueDates.label(due, now: Date()),
                        systemImage: "calendar",
                        tint: overdue ? Color(.destructive) : Color(.mutedForeground)
                    )
                }
                if showProject, let title = item.projectTitle {
                    CriaChip(text: title, systemImage: "folder", tint: Color(.primary))
                }
                ForEach(item.labels.prefix(3), id: \.localId) { label in
                    CriaChip(text: label.title, tint: Color(hexString: label.hexColor) ?? Color(.info))
                }
            }
        }
    }
}
