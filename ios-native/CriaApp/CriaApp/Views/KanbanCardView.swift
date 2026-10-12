import CriaKit
import SwiftUI

struct KanbanCardView: View {
    @Environment(\.dateDisplay) private var dateDisplay
    let services: AppServices
    let task: TaskRecord
    /// Columns the card can be moved to without dragging (empty on a read-only board).
    var moveTargets: [KanbanColumn] = []
    var onMove: (KanbanColumn) -> Void = { _ in }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            PriorityCheck(priority: task.priority, isDone: task.done, size: 22) {
                _ = try? services.store.updateTask(localId: task.localId, patch: TaskPatch(done: !task.done))
            }
            NavigationLink(value: Route.task(task.localId)) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(task.title)
                        .font(.system(size: 16, weight: .medium))
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .multilineTextAlignment(.leading)
                    if let due = task.dueDate, !task.done {
                        CriaChip(
                            text: DueDates.label(due, now: Date(), display: dateDisplay),
                            systemImage: task.repeatAfter > 0 ? "repeat" : "calendar",
                            tint: DueDates.isOverdue(due, now: Date()) ? Color(.destructive) : Color(.mutedForeground)
                        )
                    }
                }
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.trailing, 12)
        .background(Color(.cell), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .shadow(color: Color(red: 20 / 255, green: 10 / 255, blue: 40 / 255).opacity(0.05), radius: 1, y: 1)
        .contextMenu {
            if !moveTargets.isEmpty {
                Menu("Move to", systemImage: "arrow.right") {
                    ForEach(moveTargets, id: \.bucket.localId) { target in
                        Button(target.bucket.title) { onMove(target) }
                    }
                }
            }
        }
        // Dragging is not available to VoiceOver, so each column is also an action on the card.
        .accessibilityActions {
            ForEach(moveTargets, id: \.bucket.localId) { target in
                Button("Move to \(target.bucket.title)") { onMove(target) }
            }
        }
    }
}
