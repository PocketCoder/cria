import CriaKit
import SwiftUI

/// A compact card: completion ring, title, then small chips for the due date, a high priority and labels, like the
/// rows on Today.
struct KanbanCardView: View {
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.colorScheme) private var colorScheme
    /// Optional so a card shown outside the shell (a preview) still renders; VoiceOver's open action needs it.
    @Environment(NavigationModel.self) private var navigation: NavigationModel?
    /// Set by the Mac shell: a card then selects the task in the detail column instead of pushing it (as task rows do).
    @Environment(\.taskOpener) private var openTask
    let services: AppServices
    let task: TaskRecord
    var labels: [LabelRecord] = []
    /// Columns the card can be moved to without dragging (empty on a read-only board).
    var moveTargets: [KanbanColumn] = []
    var onMove: (KanbanColumn) -> Void = { _ in }
    /// Deletes the card with an Undo toast; nil on a read-only board.
    var onDelete: (() -> Void)?
    /// Subtasks in this card's column, listed inside the card instead of as cards of their own.
    var subtasks: [KanbanSubtaskRow] = []
    /// The parent's title when it is on the board in another column: shown as "↳ Parent".
    var parentTitle: String?
    var isExpanded: Binding<Bool> = .constant(false)

    static let radius: CGFloat = 14

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if !subtasks.isEmpty {
                KanbanSubtaskList(services: services, subtasks: subtasks, isExpanded: isExpanded)
            }
        }
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
    }

    @ViewBuilder private func openLink<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        if let openTask {
            Button { openTask(task.localId) } label: { content() }
        } else {
            NavigationLink(value: Route.task(task.localId)) { content() }
        }
    }

    /// The ring, title and chips. One VoiceOver element per card: activating opens the task, and the ring, columns
    /// and delete are actions. The subtask disclosure below it stays a separate element.
    private var header: some View {
        HStack(alignment: .top, spacing: Theme.checkGap) {
            PriorityCheck(priority: task.priority, isDone: task.done, size: 20) {
                _ = try? services.store.updateTask(localId: task.localId, patch: TaskPatch(done: !task.done))
            }
            // The 44pt touch target makes the margin on iOS; the Mac's smaller target needs it set.
            .padding(.leading, Theme.cardRingInset)
            .padding(.top, Theme.cardRingTop)
            openLink {
                VStack(alignment: .leading, spacing: 6) {
                    Text(task.title)
                        .font(Theme.rowSubtitle.weight(.medium))
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .multilineTextAlignment(.leading)
                        .lineLimit(4)
                    if let parentTitle {
                        Text("↳ \(parentTitle)")
                            .font(Theme.caption)
                            .foregroundStyle(Color(.mutedForeground))
                            .lineLimit(1)
                    }
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
        if let parentTitle { parts.append("subtask of \(parentTitle)") }
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
