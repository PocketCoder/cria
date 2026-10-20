import CriaKit
import SwiftUI

/// The subtasks that sit in the same column as their parent, drawn inside the parent's card: a "2/3 subtasks"
/// disclosure that opens into small rows. Each row has a completion ring and opens the task on tap.
struct KanbanSubtaskList: View {
    let services: AppServices
    let subtasks: [KanbanSubtaskRow]
    @Binding var isExpanded: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    /// The Mac's detail column opens tasks through this; without it (iOS) the row pushes the task route.
    @Environment(\.taskOpener) private var openTask

    private var doneCount: Int { subtasks.filter { $0.task.done }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .snappy) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .accessibilityHidden(true)
                    Text("\(doneCount)/\(subtasks.count) subtasks")
                        .font(Theme.caption)
                        .monospacedDigit()
                    Spacer(minLength: 0)
                }
                .foregroundStyle(Color(.mutedForeground))
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(doneCount) of \(subtasks.count) subtasks done")
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            .accessibilityHint(isExpanded ? "Hides the subtasks" : "Shows the subtasks")
            if isExpanded {
                ForEach(subtasks) { row in
                    subtaskRow(row)
                }
            }
        }
        .padding(.leading, 12)
        .padding(.bottom, isExpanded ? 6 : 0)
    }

    private func subtaskRow(_ row: KanbanSubtaskRow) -> some View {
        let task = row.task
        return HStack(spacing: 0) {
            PriorityCheck(priority: task.priority, isDone: task.done, size: 16) {
                _ = try? undo.updateTask(services, localId: task.localId, patch: TaskPatch(done: !task.done))
            }
            openLink(task.localId) {
                Text(task.title)
                    .font(Theme.caption)
                    .strikethrough(task.done)
                    .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(task.title)
            .accessibilityValue(task.done ? "Done" : "")
        }
        .padding(.leading, CGFloat(row.depth) * 16)
    }

    @ViewBuilder private func openLink<Content: View>(_ localId: String, @ViewBuilder _ content: () -> Content) -> some View {
        if let openTask {
            Button { openTask(localId) } label: { content() }
        } else {
            NavigationLink(value: Route.task(localId)) { content() }
        }
    }
}
