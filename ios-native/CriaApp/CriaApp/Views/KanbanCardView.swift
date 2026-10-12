import CriaKit
import SwiftUI

/// A compact card: completion ring, title, then small chips for the due date, a high priority and labels, like the
/// rows on Today.
struct KanbanCardView: View {
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.colorScheme) private var colorScheme
    /// Optional so a card shown outside the shell (a preview) still renders; VoiceOver's open action needs it.
    @Environment(NavigationModel.self) private var navigation: NavigationModel?
    let services: AppServices
    let task: TaskRecord
    var labels: [LabelRecord] = []
    /// Columns the card can be moved to without dragging (empty on a read-only board).
    var moveTargets: [KanbanColumn] = []
    var onMove: (KanbanColumn) -> Void = { _ in }
    /// Deletes the card with an Undo toast; nil on a read-only board.
    var onDelete: (() -> Void)?

    static let radius: CGFloat = 14

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            PriorityCheck(priority: task.priority, isDone: task.done, size: 20) {
                _ = try? services.store.updateTask(localId: task.localId, patch: TaskPatch(done: !task.done))
            }
            NavigationLink(value: Route.task(task.localId)) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(task.title)
                        .font(Theme.rowSubtitle.weight(.medium))
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .multilineTextAlignment(.leading)
                        .lineLimit(4)
                    if hasChips {
                        ChipFlowLayout { chips }
                    }
                }
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.trailing, 12)
        .background(Color(.cell), in: RoundedRectangle(cornerRadius: Self.radius, style: .continuous))
        .contentShape(.dragPreview, RoundedRectangle(cornerRadius: Self.radius, style: .continuous))
        .contextMenu {
            if !moveTargets.isEmpty {
                Menu("Move to", systemImage: "arrow.right") {
                    ForEach(moveTargets, id: \.bucket.localId) { target in
                        Button(target.bucket.title) { onMove(target) }
                    }
                }
            }
            if let onDelete {
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) { onDelete() }
            }
        }
        // One VoiceOver element per card: activating opens the task, and the ring, columns and delete are actions.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        .accessibilityValue(task.done ? "Done" : "")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { navigation?.state.push(.task(task.localId)) }
        // Dragging is not available to VoiceOver, so each column is also an action on the card.
        .accessibilityActions {
            Button(task.done ? "Mark not done" : "Mark done") {
                _ = try? services.store.updateTask(localId: task.localId, patch: TaskPatch(done: !task.done))
            }
            ForEach(moveTargets, id: \.bucket.localId) { target in
                Button("Move to \(target.bucket.title)") { onMove(target) }
            }
            if let onDelete {
                Button("Delete") { onDelete() }
            }
        }
    }

    /// Title, then the chips in reading order.
    private var spokenLabel: String {
        var parts = [task.title]
        if showsDue, let due = task.dueDate {
            let label = DueDates.label(due, now: Date(), display: dateDisplay)
            parts.append(DueDates.isOverdue(due, now: Date()) ? "overdue, \(label)" : "due \(label)")
            if task.repeatAfter > 0 { parts.append("repeats") }
        }
        if showsPriority, let name = TableCells.priorityName(task.priority) { parts.append("\(name) priority") }
        if !labels.isEmpty { parts.append("labels " + labels.map(\.title).joined(separator: ", ")) }
        return parts.joined(separator: ", ")
    }

    /// Priority shows as a chip from High up; lower ones are already the ring's colour.
    private var showsPriority: Bool { task.priority >= 3 && !task.done }
    private var showsDue: Bool { task.dueDate != nil && !task.done }
    private var hasChips: Bool { showsDue || showsPriority || !labels.isEmpty }

    @ViewBuilder private var chips: some View {
        if showsDue, let due = task.dueDate {
            CriaChip(
                text: DueDates.label(due, now: Date(), display: dateDisplay),
                systemImage: task.repeatAfter > 0 ? "repeat" : "calendar",
                tint: DueDates.isOverdue(due, now: Date()) ? Color(.destructive) : Color(.mutedForeground)
            )
        }
        if showsPriority, let name = TableCells.priorityName(task.priority) {
            CriaChip(
                text: name, systemImage: "flag.fill",
                tint: ThemeToken.priority(task.priority).map { Color($0) } ?? Color(.mutedForeground)
            )
        }
        ForEach(labels.prefix(2), id: \.localId) { label in
            CriaChip(
                text: label.title, systemImage: "tag",
                tint: LegibleTint.chip(label.hexColor, scheme: colorScheme) ?? Color(.info)
            )
        }
        if labels.count > 2 {
            CriaChip(text: "+\(labels.count - 2)", tint: Color(.mutedForeground))
        }
    }
}
