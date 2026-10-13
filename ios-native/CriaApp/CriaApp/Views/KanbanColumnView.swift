import CriaKit
import SwiftUI

/// Accepts a dragged card, unless the board is read-only. A selection tick as a dragged card moves over a new column
/// or card (a new place to land), a light impact when it drops.
private struct KanbanDropTarget: ViewModifier {
    let enabled: Bool
    /// Told when a drag enters or leaves, so the column can show it is where the card will land.
    var onTargetChange: (Bool) -> Void = { _ in }
    let action: (String) -> Bool
    @State private var targeted = false
    @State private var drops = 0

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.dropDestination(for: String.self) { items, _ in
                guard let taskId = items.first.flatMap(KanbanPayload.taskId(from:)) else { return false }
                let accepted = action(taskId)
                if accepted { drops += 1 }
                return accepted
            } isTargeted: { targeted = $0; onTargetChange($0) }
                .sensoryFeedback(trigger: targeted) { _, now in now ? SensoryFeedback.selection : nil }
                .sensoryFeedback(.impact(weight: .light), trigger: drops)
        } else {
            content
        }
    }
}

/// One column: a quiet header with the count and menu, the cards, then the add row straight after the last card.
/// The column is as tall as its content and scrolls only when that is taller than the screen. A filter-mode column
/// is read-only: no dragging, no add row, no menu.
struct KanbanColumnView: View {
    let services: AppServices
    let view: ViewRecord
    let column: KanbanColumn
    /// Every column of the board, for the cards' "Move to" menu.
    let columns: [KanbanColumn]
    /// The cards to draw: the column's own tasks, less the board filter's and less subtasks listed inside their
    /// parent's card. The count and limit still use `column.tasks`.
    let cards: [KanbanCardPlan]
    /// Cards whose subtasks are open, for the whole board.
    @Binding var expanded: Set<String>
    /// Labels by task local id.
    let labels: [String: [LabelRecord]]
    let readOnly: Bool
    /// A card of this board is being dragged: the cards are hidden and the column shrinks to its header, so every column
    /// is on screen at once to drop on. The cards stay in the view tree (zero height), because the drag started on one.
    var compact = false
    /// Told when a card of this column is picked up.
    var onDragStart: () -> Void = {}
    let onDrop: (String, String?) -> Void
    /// Moves a card to the end of another column (the "Move to" menu).
    let onMoveTo: (String, KanbanColumn) -> Void
    let onEdit: () -> Void
    let onSetRole: (KanbanBucketRole) -> Void
    /// Optional so a row shown inside a sheet (no shell environment) still deletes, without the Undo toast.
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    @State private var draft = ""
    @State private var adding = false
    @FocusState private var addFocused: Bool
    @State private var failure: String?
    /// Which drop target a dragged card is over: the column itself or one of its cards (a card sits inside the column,
    /// and SwiftUI tells only the innermost target).
    @State private var overColumn = false
    @State private var overCards: Set<String> = []

    private var isDropTarget: Bool { overColumn || !overCards.isEmpty }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 8) {
                header
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(cards) { plan in
                        card(plan)
                    }
                }
                .frame(height: compact ? 0 : nil)
                .clipped()
                .opacity(compact ? 0 : 1)
                .allowsHitTesting(!compact)
                if !readOnly && !compact { addRow }
            }
            .padding(12)
            .background(Color(.foreground).opacity(isDropTarget ? 0.10 : 0.05),
                        in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            // The column a dragged card would land in.
            .overlay {
                if isDropTarget {
                    RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.accentColor.opacity(0.6), lineWidth: 2)
                }
            }
            .animation(.easeOut(duration: 0.12), value: isDropTarget)
            .padding(.bottom, 12)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.hidden)
        // The whole height takes drops, not just the cards, so a short column is still easy to drop on.
        .contentShape(Rectangle())
        .modifier(KanbanDropTarget(enabled: !readOnly, onTargetChange: { overColumn = $0 }, action: { taskId in
            overColumn = false
            onDrop(taskId, nil)
            return true
        }))
        .errorHaptic(failure)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder private func card(_ plan: KanbanCardPlan) -> some View {
        let task = plan.task
        let open = Binding(
            get: { expanded.contains(task.localId) },
            set: { setExpanded(task.localId, $0) }
        )
        if readOnly {
            KanbanCardView(
                services: services, task: task, labels: labels[task.localId] ?? [],
                subtasks: plan.subtasks, parentTitle: plan.parentTitle, isExpanded: open
            )
        } else {
            KanbanCardView(
                services: services, task: task, labels: labels[task.localId] ?? [],
                moveTargets: columns.filter { $0.bucket.localId != column.bucket.localId },
                onMove: { target in onMoveTo(task.localId, target) },
                onDelete: { delete(task) },
                subtasks: plan.subtasks, parentTitle: plan.parentTitle, isExpanded: open
            )
            // onDrag (not draggable) so the board hears the drag begin and can shrink the columns.
            .onDrag {
                onDragStart()
                return NSItemProvider(object: KanbanPayload.make(task.localId) as NSString)
            }
            .modifier(KanbanDropTarget(enabled: true, onTargetChange: { over in
                if over { overCards.insert(task.localId) } else { overCards.remove(task.localId) }
            }, action: { taskId in
                overCards.remove(task.localId)
                guard taskId != task.localId else { return false }
                onDrop(taskId, task.localId)
                return true
            }))
        }
    }

    private func setExpanded(_ taskId: String, _ open: Bool) {
        if open {
            _ = expanded.insert(taskId)
        } else {
            _ = expanded.remove(taskId)
        }
    }

    /// A button until tapped: a text field there took a dragged card as text ("cria-task:…") instead of letting the
    /// column take the drop.
    @ViewBuilder private var addRow: some View {
        if adding {
            HStack(spacing: 8) {
                Image(systemName: "plus").foregroundStyle(Color(.primary)).accessibilityHidden(true)
                TextField("Add task", text: $draft)
                    .font(Theme.rowSubtitle)
                    .submitLabel(.done)
                    .focused($addFocused)
                    .onSubmit { addTask() }
                    .onChange(of: addFocused) { _, focused in
                        if !focused && draft.trimmingCharacters(in: .whitespaces).isEmpty { adding = false }
                    }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
        } else {
            Button {
                adding = true
                addFocused = true
            } label: {
                Label("Add task", systemImage: "plus")
                    .font(Theme.rowSubtitle)
                    .foregroundStyle(Color(.primary))
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            // Title, count and role badges read as one heading, e.g. "To do, 3 of 5 tasks, full, Done column".
            HStack(spacing: 6) {
                Text(column.bucket.title)
                    .font(Theme.rowSubtitle.weight(.semibold))
                    .foregroundStyle(Color(.foreground))
                    .lineLimit(2)
                Text(countText)
                    .font(Theme.caption)
                    .monospacedDigit()
                    .foregroundStyle(column.atLimit ? Color(.destructive) : Color(.mutedForeground))
                    .accessibilityLabel(spokenCount)
                roleBadge
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            if !readOnly && !compact { columnMenu }
        }
        .padding(.leading, 4)
        .frame(minHeight: 32)
    }

    private var spokenCount: String {
        let count = column.tasks.count
        guard column.bucket.limit > 0 else { return SpokenText.tasks(count) }
        return "\(count) of \(column.bucket.limit) tasks" + (column.atLimit ? ", full" : "")
    }

    private var columnMenu: some View {
        let roles = Kanban.roles(of: column.bucket, in: view)
        return Menu {
            Button("Edit column", systemImage: "pencil") { onEdit() }
            // The roles are stored by server id, so a column that has not synced yet cannot take one.
            if column.bucket.serverId != nil {
                Button(roles.isDone ? "Stop using as done column" : "Set as done column", systemImage: "checkmark.circle") {
                    onSetRole(.done)
                }
                Button(roles.isDefault ? "Stop using as default column" : "Set as default column", systemImage: "flag") {
                    onSetRole(.defaultColumn)
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(Theme.rowSubtitle.weight(.semibold))
                .foregroundStyle(Color(.mutedForeground))
                .frame(width: 36, height: 32)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Options for \(column.bucket.title)")
    }

    private var countText: String {
        column.bucket.limit > 0 ? "\(column.tasks.count)/\(column.bucket.limit)" : "\(column.tasks.count)"
    }

    @ViewBuilder private var roleBadge: some View {
        let roles = Kanban.roles(of: column.bucket, in: view)
        if roles.isDone {
            Image(systemName: "checkmark.circle.fill")
                .font(Theme.caption)
                .foregroundStyle(Color(.success))
                .accessibilityLabel("Done column")
        }
        if roles.isDefault {
            Image(systemName: "flag.fill")
                .font(Theme.caption)
                .foregroundStyle(Color(.primary))
                .accessibilityLabel("Default column")
        }
    }

    /// Deletes straight away; the Undo toast takes it back.
    private func delete(_ task: TaskRecord) {
        do {
            if let undo {
                try undo.deleteTask(localId: task.localId, title: task.title)
            } else {
                try services.store.deleteTask(localId: task.localId)
            }
        } catch {
            failure = String(describing: error)
        }
    }

    private func addTask() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        guard !title.isEmpty else { return }
        // A full column takes no more cards (the drag path enforces the same limit).
        guard !column.atLimit else {
            failure = "This column has reached its limit."
            draft = title
            return
        }
        do {
            let task = try services.store.createTask(TaskInput(title: title, projectLocalId: view.projectLocalId))
            try services.store.setTaskBucket(
                taskLocalId: task.localId, viewLocalId: view.localId, bucketLocalId: column.bucket.localId
            )
        } catch {
            failure = String(describing: error)
        }
    }
}
