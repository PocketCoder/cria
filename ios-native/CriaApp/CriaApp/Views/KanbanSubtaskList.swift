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
            .macPointer()
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
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title)
                        .font(Theme.caption)
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    #if os(macOS)
                    // The same glyphs as the card itself, smaller.
                    MacSubtaskSignals(task: task)
                    #endif
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .macPointer()
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

/// One of a parent's subtasks as the parent's card lists it: a pointer to the subtask's own card.
struct KanbanSubtaskPointer: Equatable, Identifiable {
    let task: TaskRecord
    /// The column the subtask's card sits in, or nil when it is not on this board (another project, or filtered).
    let column: String?
    var id: String { task.localId }
}

#if os(macOS)
/// The list a Mac parent card opens from its subtask count: every subtask on one quiet line, naming the column its
/// own card sits in. A pointer, not a copy: it has no tick, and a click selects the real task.
struct KanbanSubtaskPointerList: View {
    let pointers: [KanbanSubtaskPointer]
    @Environment(\.taskOpener) private var openTask

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(pointers) { pointer in
                Button {
                    openTask?(pointer.task.localId)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: pointer.task.done ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 11))
                            .foregroundStyle(MacTheme.label3)
                        Text(pointer.task.title)
                            .font(.system(size: 12))
                            .strikethrough(pointer.task.done)
                            .foregroundStyle(pointer.task.done ? MacTheme.label3 : MacTheme.label2)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Text(pointer.column ?? "Elsewhere")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(MacTheme.label2)
                            .padding(.horizontal, 6)
                            .frame(height: 16)
                            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.1)))
                        Image(systemName: "arrow.right").font(.system(size: 9)).foregroundStyle(MacTheme.label3)
                    }
                    .frame(minHeight: 24)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .macPointer()
                .accessibilityLabel(
                    "\(pointer.task.title), \(pointer.task.done ? "done" : "open"), in \(pointer.column ?? "another place")"
                )
            }
        }
        .padding(.top, 4)
        .overlay(alignment: .top) { Rectangle().fill(Color.primary.opacity(0.08)).frame(height: 0.5) }
        // Under the title's text edge, not the card's: ring inset, the 16pt ring and the gap.
        .padding(.leading, Theme.cardRingInset + 16 + Theme.checkGap)
        .padding(.trailing, 10)
        .padding(.bottom, 8)
    }
}
#endif
