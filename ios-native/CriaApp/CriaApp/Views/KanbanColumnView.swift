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

/// One column: a quiet header with the count and menu, the cards, then the add row straight after the last card.
/// The column is as tall as its content and scrolls only when that is taller than the screen. A filter-mode column
/// is read-only: no dragging, no add row, no menu.
struct KanbanColumnView: View {
    let services: AppServices
    let view: ViewRecord
    let column: KanbanColumn
    /// Every column of the board, for the cards' "Move to" menu.
    let columns: [KanbanColumn]
    /// Labels by task local id.
    let labels: [String: [LabelRecord]]
    let readOnly: Bool
    let onDrop: (String, String?) -> Void
    /// Moves a card to the end of another column (the "Move to" menu).
    let onMoveTo: (String, KanbanColumn) -> Void
    let onEdit: () -> Void
    let onSetRole: (KanbanBucketRole) -> Void
    /// Optional so a row shown inside a sheet (no shell environment) still deletes, without the Undo toast.
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    @State private var draft = ""
    @State private var failure: String?

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 8) {
                header
                ForEach(column.tasks, id: \.localId) { task in
                    card(task)
                }
                if !readOnly { addRow }
            }
            .padding(12)
            .background(Color(.foreground).opacity(0.05), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .padding(.bottom, 12)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.hidden)
        // The whole height takes drops, not just the cards, so a short column is still easy to drop on.
        .contentShape(Rectangle())
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
            KanbanCardView(services: services, task: task, labels: labels[task.localId] ?? [])
        } else {
            KanbanCardView(
                services: services, task: task, labels: labels[task.localId] ?? [],
                moveTargets: columns.filter { $0.bucket.localId != column.bucket.localId },
                onMove: { target in onMoveTo(task.localId, target) },
                onDelete: { delete(task) }
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
            Image(systemName: "plus").foregroundStyle(Color(.primary)).accessibilityHidden(true)
            TextField("Add task", text: $draft)
                .font(Theme.rowSubtitle)
                .submitLabel(.done)
                .onSubmit { addTask() }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
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
            if !readOnly { columnMenu }
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
