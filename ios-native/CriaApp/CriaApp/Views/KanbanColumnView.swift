import CriaKit
import SwiftUI

/// One column: a quiet header with the count and menu, the cards, then the add row straight after the last card.
/// The column is as tall as its content and scrolls only when that is taller than the screen. A filter-mode column
/// is read-only: no dragging, no add row, no menu.
struct KanbanColumnView: View {
    #if os(macOS)
    // The Mac design: radius 16, padding 8, the window's hover fill, a 1.5pt primary ring while dragged over.
    private static let radius: CGFloat = 16
    private static let padding: CGFloat = 8
    private static let dropOpacity = 1.0
    private static let dropWidth: CGFloat = 1.5
    private var columnFill: Color { isDropTarget ? Color(.foreground).opacity(0.10) : MacTheme.fill }
    /// The 30pt header with the name in SF 13 Semibold and the count in `l3`, and the 30pt Add task row.
    static let headerHeight: CGFloat = 30
    private static let addRowHeight: CGFloat = 30
    static let titleFont = Font.system(size: 13, weight: .semibold)
    static let countColour = MacTheme.label3
    #else
    private static let radius: CGFloat = 20
    private static let padding: CGFloat = 12
    private static let dropOpacity = 0.6
    private static let dropWidth: CGFloat = 2
    private var columnFill: Color { Color(.foreground).opacity(isDropTarget ? 0.10 : 0.05) }
    static let headerHeight: CGFloat = 32
    private static let addRowHeight: CGFloat = 40
    static let titleFont = Theme.rowSubtitle.weight(.semibold)
    static let countColour = Color(.mutedForeground)
    #endif

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
    /// Parent titles and subtask progress by task local id.
    var subtaskInfo = KanbanSubtaskInfo()
    let readOnly: Bool
    /// A card is being dragged and has left its own column: this column shrinks to its header so every column is on
    /// screen at once to drop on. It opens again (not compact) while the card is over it. The cards stay in the view tree
    /// (zero height), because the drag started on one.
    var compact = false
    /// Shown as a narrow strip, remembered per view by the board. `onToggleCollapse` flips it.
    var collapsed = false
    var onToggleCollapse: () -> Void = {}
    /// Told when a card of this column is picked up.
    var onDragStart: () -> Void = {}
    /// Told when the dragged card enters or leaves this column (or one of its cards).
    var onOver: (Bool) -> Void = { _ in }
    /// Told when a drop on one of this column's own cards changed nothing, so the board can expand again.
    var onDragEnd: () -> Void = {}
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
    #if os(macOS)
    @State private var confirmingDelete = false
    #endif

    private var isDropTarget: Bool { overColumn || !overCards.isEmpty }

    /// Llama purple on the Mac, whose accent colour is the user's own (iOS unchanged).
    private var dropOutline: Color {
        #if os(macOS)
        Color(.primary)
        #else
        Color.accentColor
        #endif
    }

    var body: some View {
        if collapsed {
            // A card dropped on the strip goes to the end of this column, as on an open one.
            KanbanCollapsedStrip(title: column.bucket.title, count: column.tasks.count, onExpand: onToggleCollapse)
                .overlay {
                    if overColumn {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(dropOutline.opacity(Self.dropOpacity), lineWidth: Self.dropWidth)
                    }
                }
                .animation(.easeOut(duration: 0.12), value: overColumn)
                .onChange(of: overColumn) { _, over in onOver(over) }
                .modifier(KanbanDropTarget(enabled: !readOnly, onTargetChange: { overColumn = $0 }, action: { taskId in
                    overColumn = false
                    onDrop(taskId, nil)
                    return true
                }))
        } else {
            expandedBody
        }
    }

    private var expandedBody: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 8) {
                header
                // Lazy, so a long column builds only the cards on screen.
                LazyVStack(alignment: .leading, spacing: 8) {
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
            .padding(Self.padding)
            .background(columnFill, in: RoundedRectangle(cornerRadius: Self.radius, style: .continuous))
            // The column a dragged card would land in.
            .overlay {
                if isDropTarget {
                    RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
                        .strokeBorder(dropOutline.opacity(Self.dropOpacity), lineWidth: Self.dropWidth)
                }
            }
            .animation(.easeOut(duration: 0.12), value: isDropTarget)
            .padding(.bottom, 12)
        }
        .onChange(of: isDropTarget) { _, over in onOver(over) }
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
        #if os(macOS)
        .confirmationDialog(
            "Delete \"\(column.bucket.title)\"?", isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button("Delete column", role: .destructive) { deleteColumn() }
        }
        #endif
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
                subtasks: plan.subtasks,
                parentTitle: plan.parentTitle ?? subtaskInfo.parentTitles[task.localId],
                progress: subtaskInfo.progress[task.localId], isExpanded: open
            )
        } else {
            KanbanCardView(
                services: services, task: task, labels: labels[task.localId] ?? [],
                moveTargets: columns.filter { $0.bucket.localId != column.bucket.localId },
                onMove: { target in onMoveTo(task.localId, target) },
                onDelete: { delete(task) },
                subtasks: plan.subtasks,
                parentTitle: plan.parentTitle ?? subtaskInfo.parentTitles[task.localId],
                progress: subtaskInfo.progress[task.localId], isExpanded: open
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
                guard taskId != task.localId else {
                    onDragEnd()
                    return false
                }
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
            .frame(minHeight: Self.addRowHeight)
        } else {
            Button {
                adding = true
                addFocused = true
            } label: {
                Label("Add task", systemImage: "plus")
                    .font(Theme.rowSubtitle)
                    .foregroundStyle(Color(.primary))
                    .frame(maxWidth: .infinity, minHeight: Self.addRowHeight, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
        }
    }
}

// MARK: Actions

extension KanbanColumnView {
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

#if os(macOS)
// MARK: Mac column menu

extension KanbanColumnView {
    /// Rename column…, Set limit…, Mark as done column, Delete column. Rename and the limit are the edit sheet's
    /// fields; the done role is stored by server id, so an unsynced column cannot take it.
    @ViewBuilder func macColumnMenu(isDone: Bool) -> some View {
        Button("Rename column…", systemImage: "pencil") { onEdit() }
        Button("Set limit…", systemImage: "number") { onEdit() }
        Toggle(isOn: Binding(get: { isDone }, set: { _ in onSetRole(.done) })) {
            Label("Mark as done column", systemImage: "checkmark.circle")
        }
        .disabled(column.bucket.serverId == nil)
        Divider()
        // The server refuses to delete the last column of a board.
        Button("Delete column", systemImage: "trash", role: .destructive) { confirmingDelete = true }
            .disabled(columns.count < 2)
    }

    private func deleteColumn() {
        guard columns.count > 1 else { return }
        do {
            try services.store.deleteBucket(localId: column.bucket.localId)
        } catch {
            failure = String(describing: error)
        }
    }
}
#endif
