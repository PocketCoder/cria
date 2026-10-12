import CriaKit
import SwiftUI

/// Accepts a dragged card, unless the board is read-only.
private struct KanbanDropTarget: ViewModifier {
    let enabled: Bool
    let action: (String) -> Bool

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.dropDestination(for: String.self) { items, _ in
                guard let taskId = items.first.flatMap(KanbanPayload.taskId(from:)) else { return false }
                return action(taskId)
            }
        } else {
            content
        }
    }
}

/// One column: header with count and menu, cards, and an inline add box. A filter-mode column is read-only: no
/// dragging, no add box, no menu.
struct KanbanColumnView: View {
    let services: AppServices
    let view: ViewRecord
    let column: KanbanColumn
    /// Every column of the board, for the cards' "Move to" menu.
    let columns: [KanbanColumn]
    let readOnly: Bool
    let onDrop: (String, String?) -> Void
    /// Moves a card to the end of another column (the "Move to" menu).
    let onMoveTo: (String, KanbanColumn) -> Void
    let onEdit: () -> Void
    let onSetRole: (KanbanBucketRole) -> Void
    @State private var draft = ""
    @State private var failure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(column.tasks, id: \.localId) { task in
                        card(task)
                    }
                }
            }
            if !readOnly { addRow }
        }
        .padding(8)
        .frame(width: 300)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color(.foreground).opacity(0.06), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .modifier(KanbanDropTarget(enabled: !readOnly) { taskId in
            onDrop(taskId, nil)
            return true
        })
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder private func card(_ task: TaskRecord) -> some View {
        if readOnly {
            KanbanCardView(services: services, task: task)
        } else {
            KanbanCardView(
                services: services, task: task,
                moveTargets: columns.filter { $0.bucket.localId != column.bucket.localId },
                onMove: { target in onMoveTo(task.localId, target) }
            )
            .draggable(KanbanPayload.make(task.localId))
            .modifier(KanbanDropTarget(enabled: true) { taskId in
                guard taskId != task.localId else { return false }
                onDrop(taskId, task.localId)
                return true
            })
        }
    }

    private var addRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "plus").foregroundStyle(Color(.primary))
            TextField("Add task", text: $draft)
                .font(.subheadline.weight(.medium))
                .onSubmit { addTask() }
        }
        .padding(.horizontal, 12)
        .frame(height: 44)
    }

    private var header: some View {
        HStack {
            Text(column.bucket.title).font(Theme.headline)
            Text(countText)
                .font(Theme.chip)
                .padding(.horizontal, 8)
                .frame(height: Theme.chipHeight)
                .background(Color(.foreground).opacity(0.06), in: Capsule())
                .foregroundStyle(column.atLimit ? Color(.destructive) : Color(.mutedForeground))
            roleBadge
            Spacer()
            if !readOnly { columnMenu }
        }
    }

    private var columnMenu: some View {
        let roles = Kanban.roles(of: column.bucket, in: view)
        return Menu("Column", systemImage: "ellipsis") {
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
        }
        .labelStyle(.iconOnly)
    }

    private var countText: String {
        column.bucket.limit > 0 ? "\(column.tasks.count)/\(column.bucket.limit)" : "\(column.tasks.count)"
    }

    @ViewBuilder private var roleBadge: some View {
        let roles = Kanban.roles(of: column.bucket, in: view)
        if roles.isDone {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(.success)).accessibilityLabel("Done column")
        }
        if roles.isDefault {
            Image(systemName: "flag.fill").foregroundStyle(Color(.primary)).accessibilityLabel("Default column")
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
