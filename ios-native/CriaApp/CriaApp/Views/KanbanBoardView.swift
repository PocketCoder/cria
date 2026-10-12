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
    @State private var live: LiveValue<KanbanBoardData>
    @State private var editing: BucketEdit?
    @State private var newBucketTitle = ""
    @State private var addingBucket = false
    @State private var limitNotice = false
    @State private var failure: String?
    @State private var filtering = false
    /// The board's filter, kept per view on this device (see `BoardFilter`).
    @AppStorage private var filterText: String
    @Environment(\.dynamicTypeSize) private var typeSize

    init(services: AppServices, view: ViewRecord) {
        self.services = services
        self.view = view
        _filterText = AppStorage(wrappedValue: "", BoardFilter.storageKey(viewLocalId: view.localId))
        let store = services.store
        let viewId = view.localId
        _live = State(initialValue: LiveValue(initial: KanbanBoardData()) {
            observeStore(store, kinds: [.tasks, .views, .projects, .labels]) { (reading: CriaStore) throws -> KanbanBoardData in
                let columns = try reading.kanbanColumns(viewLocalId: viewId)
                var labels: [String: [LabelRecord]] = [:]
                for item in try reading.attachRowData(columns.flatMap(\.tasks)) where !item.labels.isEmpty {
                    labels[item.task.localId] = item.labels
                }
                return KanbanBoardData(columns: columns, labels: labels, allLabels: try reading.labels())
            }
        })
    }

    private var columns: [KanbanColumn] { live.value.columns }
    private var readOnly: Bool { Kanban.isFilterMode(view) }
    private var filter: BoardFilter { BoardFilter.from(stored: filterText) }

    /// The cards a column shows. Drops, limits and "Move to" still work on the whole column, so a hidden card keeps
    /// its place and a filtered column is never mistaken for a full one.
    private func shown(_ column: KanbanColumn) -> [TaskRecord] {
        guard filter.isActive else { return column.tasks }
        return filter.apply(to: column.tasks, labels: live.value.labelIds)
    }

    private var hiddenCount: Int {
        columns.reduce(0) { $0 + $1.tasks.count - shown($1).count }
    }

    /// About 85% of the screen, so the next column peeks in, within 280 to 340 points. Larger text widens the cap,
    /// and accessibility sizes take nearly the whole width so titles and chips are not squeezed.
    private static func columnWidth(_ available: CGFloat, typeSize: DynamicTypeSize) -> CGFloat {
        if typeSize.isAccessibilitySize { return available * 0.94 }
        let cap: CGFloat = typeSize >= .xxLarge ? 400 : 340
        return min(max(available * 0.85, 280), cap)
    }

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(columns, id: \.bucket.localId) { column in
                    KanbanColumnView(
                        services: services,
                        view: view,
                        column: column,
                        columns: columns,
                        shown: shown(column),
                        labels: live.value.labels,
                        readOnly: readOnly,
                        onDrop: { taskId, beforeId in drop(taskId, into: column, before: beforeId) },
                        onMoveTo: { taskId, target in drop(taskId, into: target, before: nil) },
                        onEdit: { editing = BucketEdit(bucket: column.bucket, canDelete: columns.count > 1) },
                        onSetRole: { role in setRole(role, of: column.bucket) }
                    )
                    .containerRelativeFrame(.horizontal) { length, _ in Self.columnWidth(length, typeSize: typeSize) }
                }
                if !readOnly { addBucketButton }
            }
            .scrollTargetLayout()
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.hidden)
        .background(Color(.grouped))
        .safeAreaInset(edge: .bottom, spacing: 0) { notices }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(
                    "Filter cards",
                    systemImage: filter.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
                ) {
                    filtering = true
                }
            }
        }
        .sheet(isPresented: $filtering) {
            KanbanFilterSheet(
                filter: Binding(get: { filter }, set: { filterText = $0.stored }), labels: live.value.allLabels
            )
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

    @ViewBuilder private var notices: some View {
        VStack(spacing: 0) {
            if filter.isActive {
                HStack {
                    Text(hiddenCount == 1 ? "Filter hides 1 card" : "Filter hides \(hiddenCount) cards")
                    Button("Clear") { filterText = "" }
                }
                .font(Theme.caption)
                .foregroundStyle(Color(.mutedForeground))
                .padding(.vertical, 8)
            }
            if readOnly {
                Text("This board is managed by filters, so cards and columns cannot be changed here.")
                    .font(Theme.caption)
                    .foregroundStyle(Color(.mutedForeground))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .background(Color(.grouped))
    }

    private var addBucketButton: some View {
        Button { addingBucket = true } label: {
            Label("Add column", systemImage: "plus")
                .font(Theme.rowSubtitle.weight(.medium))
                .foregroundStyle(Color(.primary))
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color(.primary).opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                )
        }
        .buttonStyle(.plain)
    }

    private func addBucket() {
        let title = newBucketTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        newBucketTitle = ""
        guard !title.isEmpty else { return }
        let last = columns.last?.bucket.position ?? 0
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

/// The board's columns, plus each card's labels for the chips.
struct KanbanBoardData: Equatable, Sendable {
    var columns: [KanbanColumn] = []
    var labels: [String: [LabelRecord]] = [:]
    /// Every label, for the filter's label choices.
    var allLabels: [LabelRecord] = []

    /// Label local ids by task, for `BoardFilter`.
    var labelIds: [String: [String]] { labels.mapValues { $0.map(\.localId) } }
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
