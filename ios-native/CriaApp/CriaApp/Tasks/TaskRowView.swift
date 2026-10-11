import CriaKit
import SwiftUI

/// One task row: priority ring, title, optional description, then tinted chips for due date, project and labels.
struct TaskRowView: View {
    @Environment(\.dateDisplay) private var dateDisplay
    let item: TaskListItem
    var showProject = false
    let onToggle: () -> Void

    private var task: TaskRecord { item.task }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            PriorityCheck(priority: task.priority, isDone: task.done, action: onToggle)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Text(task.title)
                        .font(Theme.rowTitle)
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .lineLimit(1)
                    if task.isFavorite {
                        Image(systemName: "star.fill").font(.system(size: 13)).foregroundStyle(Color(.warning))
                    }
                }
                .padding(.top, 10)
                metadata
                    .padding(.top, 6)
                    .padding(.bottom, 12)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var metadata: some View {
        let due = task.dueDate
        let chips = item.labels.count + (showProject && item.projectTitle != nil ? 1 : 0) + (due == nil ? 0 : 1)
        if chips > 0 && !task.done {
            HStack(spacing: 6) {
                if let due {
                    let overdue = DueDates.isOverdue(due, now: Date())
                    CriaChip(
                        text: DueDates.label(due, now: Date(), display: dateDisplay),
                        systemImage: task.repeatAfter > 0 ? "repeat" : "calendar",
                        tint: overdue ? Color(.destructive) : Color(.mutedForeground)
                    )
                }
                if showProject, let title = item.projectTitle {
                    CriaChip(text: title, tint: Color(.mutedForeground))
                }
                ForEach(item.labels.prefix(3), id: \.localId) { label in
                    CriaChip(text: label.title, systemImage: "tag", tint: Color(hexString: label.hexColor) ?? Color(.info))
                }
            }
        }
    }
}
