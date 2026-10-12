import CriaKit
import SwiftUI

/// What a dragged card carries. The prefix keeps text dragged in from another app from being read as a task id.
enum KanbanPayload {
    private static let prefix = "cria-task:"

    static func make(_ taskLocalId: String) -> String { prefix + taskLocalId }

    static func taskId(from text: String) -> String? {
        text.hasPrefix(prefix) ? String(text.dropFirst(prefix.count)) : nil
    }
}

/// A kanban board: a horizontally paging scroll of bucket columns. Cards drag within and across columns. A
/// filter-mode board (columns defined by filters) is read-only.
struct KanbanBoardView: View {
    let services: AppServices
    let view: ViewRecord
    @State private var live: LiveValue<[KanbanColumn]>
    @State private var editing: BucketEdit?
    @State private var newBucketTitle = ""
    @State private var addingBucket = false
    @State private var limitNotice = false
    @State private var failure: String?

    init(services: AppServices, view: ViewRecord) {
        self.services = services
        self.view = view
        let store = services.store
        let viewId = view.localId
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .views, .projects]) { reading in
                try reading.kanbanColumns(viewLocalId: viewId)
            }
        })
    }

    private var readOnly: Bool { Kanban.isFilterMode(view) }

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(live.value, id: \.bucket.localId) { column in
                    KanbanColumnView(
                        services: services,
                        view: view,
                        column: column,
                        columns: live.value,
                        readOnly: readOnly,
                        onDrop: { taskId, beforeId in drop(taskId, into: column, before: beforeId) },
                        onMoveTo: { taskId, target in drop(taskId, into: target, before: nil) },
                        onEdit: { editing = BucketEdit(bucket: column.bucket, canDelete: live.value.count > 1) },
                        onSetRole: { role in setRole(role, of: column.bucket) }
                    )
                }
                if !readOnly { addBucketButton }
            }
            .scrollTargetLayout()
            .padding(.vertical, 12)
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .scrollTargetBehavior(.viewAligned)
        .background(Color(.grouped))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if readOnly {
                Text("This board is managed by filters, so cards and columns cannot be changed here.")
                    .font(Theme.caption)
                    .foregroundStyle(Color(.mutedForeground))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(Color(.grouped))
            }
        }
        .task { await live.run() }
        .alert("Column full", isPresented: $limitNotice) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This column has reached its limit.")
        }
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
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
        do {
            _ = try services.store.createBucket(input)
        } catch {
            failure = String(describing: error)
        }
    }

    private func setRole(_ role: KanbanBucketRole, of bucket: BucketRecord) {
        guard let serverId = bucket.serverId else { return }
        let roles = Kanban.roles(of: bucket, in: view)
        // Choosing the column that already has the role clears it, as in the web app.
        let update: ViewUpdate
        switch role {
        case .done: update = ViewUpdate(doneBucketServerId: .some(roles.isDone ? nil : serverId))
        case .defaultColumn: update = ViewUpdate(defaultBucketServerId: .some(roles.isDefault ? nil : serverId))
        }
        do {
            _ = try services.store.updateView(localId: view.localId, update)
        } catch {
            failure = String(describing: error)
        }
    }

    private func drop(_ taskId: String, into column: KanbanColumn, before beforeId: String?) {
        guard !readOnly else { return }
        let order = Kanban.orderAfterDrop(order: column.tasks.map(\.localId), moving: taskId, onto: beforeId)
        do {
            let result = try services.store.moveCard(
                taskLocalId: taskId, viewLocalId: view.localId, target: column, orderedIds: order
            )
            if result == .blockedByLimit { limitNotice = true }
        } catch {
            failure = String(describing: error)
        }
    }
}

struct BucketEdit: Identifiable {
    let bucket: BucketRecord
    /// False for the last column: the server refuses to delete a view's only bucket.
    let canDelete: Bool
    var id: String { bucket.localId }
}

/// The role a column can take for its view.
enum KanbanBucketRole {
    case done, defaultColumn
}
