import CriaKit
import SwiftUI

/// A kanban board: a horizontally paging scroll of bucket columns. Cards drag within and across columns.
struct KanbanBoardView: View {
    let services: AppServices
    let view: ViewRecord
    @State private var live: LiveValue<[KanbanColumn]>
    @State private var editing: BucketEdit?
    @State private var newBucketTitle = ""
    @State private var addingBucket = false
    @State private var limitNotice = false

    init(services: AppServices, view: ViewRecord) {
        self.services = services
        self.view = view
        let store = services.store
        let viewId = view.localId
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .projects]) { reading in
                try reading.kanbanColumns(viewLocalId: viewId)
            }
        })
    }

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(live.value, id: \.bucket.localId) { column in
                    KanbanColumnView(
                        services: services,
                        view: view,
                        column: column,
                        onDrop: { taskId, beforeId in drop(taskId, into: column, before: beforeId) },
                        onEdit: { editing = BucketEdit(bucket: column.bucket) }
                    )
                }
                addBucketButton
            }
            .scrollTargetLayout()
            .padding(12)
        }
        .scrollTargetBehavior(.viewAligned)
        .background(Color(.background))
        .task { await live.run() }
        .alert("Column full", isPresented: $limitNotice) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This column has reached its limit.")
        }
        .alert("New column", isPresented: $addingBucket) {
            TextField("Title", text: $newBucketTitle)
            Button("Add") { addBucket() }
            Button("Cancel", role: .cancel) { newBucketTitle = "" }
        }
        .sheet(item: $editing) { edit in
            BucketEditSheet(services: services, edit: edit)
        }
    }

    private var addBucketButton: some View {
        Button("Add column", systemImage: "plus") { addingBucket = true }
            .buttonStyle(.bordered)
            .frame(width: 160)
    }

    private func addBucket() {
        let title = newBucketTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        newBucketTitle = ""
        guard !title.isEmpty else { return }
        let last = live.value.last?.bucket.position ?? 0
        let input = BucketInput(title: title, viewLocalId: view.localId, position: last + Position.baseStep)
        _ = try? services.store.createBucket(input)
    }

    private func drop(_ taskId: String, into column: KanbanColumn, before beforeId: String?) {
        var order = column.tasks.map(\.localId).filter { $0 != taskId }
        if let beforeId, let index = order.firstIndex(of: beforeId) {
            order.insert(taskId, at: index)
        } else {
            order.append(taskId)
        }
        let result = try? services.store.moveCard(
            taskLocalId: taskId, viewLocalId: view.localId, target: column, orderedIds: order
        )
        if result == .blockedByLimit { limitNotice = true }
    }
}

struct BucketEdit: Identifiable {
    let bucket: BucketRecord
    var id: String { bucket.localId }
}

/// One column: header with count and menu, cards, and an inline add box.
struct KanbanColumnView: View {
    let services: AppServices
    let view: ViewRecord
    let column: KanbanColumn
    let onDrop: (String, String?) -> Void
    let onEdit: () -> Void
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(column.tasks, id: \.localId) { task in
                        KanbanCardView(services: services, task: task)
                            .draggable(task.localId)
                            .dropDestination(for: String.self) { items, _ in
                                guard let taskId = items.first, taskId != task.localId else { return false }
                                onDrop(taskId, task.localId)
                                return true
                            }
                    }
                }
            }
            TextField("Add a task", text: $draft)
                .textFieldStyle(.roundedBorder)
                .onSubmit { addTask() }
        }
        .padding(10)
        .frame(width: 280)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color(.muted), in: RoundedRectangle(cornerRadius: Theme.radius))
        .dropDestination(for: String.self) { items, _ in
            guard let taskId = items.first else { return false }
            onDrop(taskId, nil)
            return true
        }
    }

    private var header: some View {
        HStack {
            Text(column.bucket.title).font(Theme.headline)
            Text(countText)
                .font(Theme.caption)
                .foregroundStyle(column.atLimit ? Color(.destructive) : Color(.mutedForeground))
            roleBadge
            Spacer()
            Menu("Column", systemImage: "ellipsis") {
                Button("Edit column", systemImage: "pencil") { onEdit() }
            }
            .labelStyle(.iconOnly)
        }
    }

    private var countText: String {
        column.bucket.limit > 0 ? "\(column.tasks.count)/\(column.bucket.limit)" : "\(column.tasks.count)"
    }

    @ViewBuilder private var roleBadge: some View {
        let roles = Kanban.roles(of: column.bucket, in: view)
        if roles.isDone {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(.success))
        }
    }

    private func addTask() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        guard !title.isEmpty else { return }
        let input = TaskInput(title: title, projectLocalId: view.projectLocalId)
        guard let task = try? services.store.createTask(input) else { return }
        try? services.store.setTaskBucket(
            taskLocalId: task.localId, viewLocalId: view.localId, bucketLocalId: column.bucket.localId
        )
    }
}

struct KanbanCardView: View {
    let services: AppServices
    let task: TaskRecord

    var body: some View {
        NavigationLink(value: Route.task(task.localId)) {
            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .font(Theme.rowTitle)
                    .strikethrough(task.done)
                    .foregroundStyle(Color(.foreground))
                    .multilineTextAlignment(.leading)
                if let due = task.dueDate {
                    CriaChip(text: DueDates.label(due, now: Date()), systemImage: "calendar", tint: Color(.mutedForeground))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color(.card), in: RoundedRectangle(cornerRadius: Theme.radius))
        }
        .buttonStyle(.plain)
    }
}

/// Rename a bucket, set its limit, or delete it.
struct BucketEditSheet: View {
    let services: AppServices
    let edit: BucketEdit
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var limitText = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                TextField("Limit (0 for none)", text: $limitText).keyboardType(.numberPad)
                Button("Delete column", role: .destructive) {
                    try? services.store.deleteBucket(localId: edit.bucket.localId)
                    dismiss()
                }
            }
            .navigationTitle("Edit column")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            title = edit.bucket.title
            limitText = String(edit.bucket.limit)
        }
    }

    private func save() {
        let cleaned = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let update = BucketUpdate(title: cleaned.isEmpty ? nil : cleaned, limit: Kanban.parseLimit(limitText))
        _ = try? services.store.updateBucket(localId: edit.bucket.localId, update)
        dismiss()
    }
}
