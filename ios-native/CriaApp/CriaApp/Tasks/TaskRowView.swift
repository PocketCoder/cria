import CriaKit
import SwiftUI

/// One task row: priority ring, title, optional description, then tinted chips for subtasks, due date, project and
/// labels. A nested row is indented under its parent, with a guide line per level.
struct TaskRowView: View {
    @Environment(\.dateDisplay) private var dateDisplay
    let item: TaskListItem
    var showProject = false
    var tree = TaskRowTree()
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
                if let parent = tree.parentTitle {
                    Text("Subtask of ‘\(parent)’")
                        .font(Theme.caption)
                        .foregroundStyle(Color(.mutedForeground))
                        .lineLimit(1)
                        .padding(.top, 2)
                }
                metadata
                    .padding(.top, 6)
                    .padding(.bottom, 12)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, CGFloat(tree.depth) * TaskListNesting.indent)
        .background(alignment: .leading) { guides }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// One thin line per level, under each ancestor's ring.
    @ViewBuilder private var guides: some View {
        if tree.depth > 0 {
            ZStack(alignment: .leading) {
                ForEach(0..<tree.depth, id: \.self) { level in
                    Rectangle()
                        .fill(Color(.mutedForeground).opacity(0.25))
                        .frame(width: 1.5)
                        .offset(x: CGFloat(level) * TaskListNesting.indent + 21)
                }
            }
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder private var metadata: some View {
        let due = task.done ? nil : task.dueDate
        let others = task.done ? 0 : item.labels.count + (showProject && item.projectTitle != nil ? 1 : 0)
        if others + (due == nil ? 0 : 1) > 0 || tree.progress != nil {
            HStack(spacing: 6) {
                if let progress = tree.progress { subtaskChip(progress) }
                if let due {
                    let overdue = DueDates.isOverdue(due, now: Date())
                    CriaChip(
                        text: DueDates.label(due, now: Date(), display: dateDisplay),
                        systemImage: task.repeatAfter > 0 ? "repeat" : "calendar",
                        tint: overdue ? Color(.destructive) : Color(.mutedForeground)
                    )
                }
                if showProject && !task.done, let title = item.projectTitle {
                    CriaChip(text: title, tint: Color(.mutedForeground))
                }
                if !task.done {
                    ForEach(item.labels.prefix(3), id: \.localId) { label in
                        CriaChip(text: label.title, systemImage: "tag", tint: Color(hexString: label.hexColor) ?? Color(.info))
                    }
                }
            }
        }
    }

    /// "2/5" subtasks done. Where the children are nested here it also collapses them, with a chevron showing which
    /// way; the padding widens the tap target without moving the chip.
    @ViewBuilder private func subtaskChip(_ progress: SubtaskProgress) -> some View {
        let tint = progress.done == progress.total ? Color(.success) : Color(.mutedForeground)
        let text = "\(progress.done)/\(progress.total)"
        if let collapsed = tree.isCollapsed {
            Button(action: tree.onToggleCollapsed) {
                CriaChip(text: text, systemImage: collapsed ? "chevron.right" : "chevron.down", tint: tint)
                    .padding(8)
                    .contentShape(Rectangle())
                    .padding(-8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(collapsed ? "Show subtasks" : "Hide subtasks")
        } else {
            CriaChip(text: text, systemImage: "list.bullet.indent", tint: tint)
                .accessibilityLabel("\(progress.done) of \(progress.total) subtasks done")
        }
    }
}
