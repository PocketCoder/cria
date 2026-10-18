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
    /// A card is being dragged: the columns shrink to headers so all of them fit on screen.
    @State private var dragging = false
    @State private var dragStartedAt: Date?
    /// The column the dragged card came from. A drag starts as a reorder in that column; once the card leaves it, every
    /// column shrinks to a header (`leftSource`) so any of them can be picked without scrolling, and the column the card
    /// is over (`hoverColumn`) opens to show its cards, to choose where in it the card goes.
    @State private var dragSource: String?
    @State private var leftSource = false
    @State private var sourceWasTargeted = false
    @State private var hoverColumn: String?
    @State private var expandedCards: Set<String> = []
    /// The board's filter, kept per view on this device (see `BoardFilter`).
    @AppStorage private var filterText: String
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.preferences) private var preferences

    init(services: AppServices, view: ViewRecord) {
        self.services = services
        self.view = view
        _filterText = AppStorage(wrappedValue: "", BoardFilter.storageKey(viewLocalId: view.localId))
        let store = services.store
        let viewId = view.localId
        let projectId = view.projectLocalId
        _live = State(initialValue: LiveValue(initial: KanbanBoardData()) {
            observeStore(store, kinds: [.tasks, .views, .projects, .labels]) { (reading: CriaStore) throws -> KanbanBoardData in
                let columns = try reading.kanbanColumns(viewLocalId: viewId)
                var labels: [String: [LabelRecord]] = [:]
                for item in try reading.attachRowData(columns.flatMap(\.tasks)) where !item.labels.isEmpty {
                    labels[item.task.localId] = item.labels
                }
                // The subtask map is read once per load, so cards need no query of their own.
                return KanbanBoardData(
                    columns: columns, labels: labels, allLabels: try reading.labels(),
                    children: try reading.subtaskMap(projectLocalId: projectId),
                    subtaskInfo: try KanbanSubtaskInfo.read(reading, tasks: columns.flatMap(\.tasks))
                )
            }
        })
    }

    private var columns: [KanbanColumn] { live.value.columns }
    private var readOnly: Bool { Kanban.isFilterMode(view) }
    private var filter: BoardFilter { BoardFilter.from(stored: filterText) }

    /// Which cards each column draws and which subtasks ride inside them. Drops, limits and "Move to" still work on
    /// the whole column, so a hidden or nested task keeps its place and a filtered column is never mistaken for a
    /// full one.
    private var plan: KanbanBoardPlan {
        let filter = self.filter
        guard filter.isActive else { return KanbanNesting.plan(columns: columns, children: live.value.children, nests: Self.nests) }
        let labelIds = live.value.labelIds
        return KanbanNesting.plan(columns: columns, children: live.value.children, nests: Self.nests) {
            filter.shows($0, labelIds: labelIds[$0.localId] ?? [])
        }
    }

    /// On the Mac every subtask is its own card, so it can be dragged to another column by itself; iOS lists a
    /// subtask inside its parent's card when they share a column.
    private static var nests: Bool {
        #if os(macOS)
        false
        #else
        true
        #endif
    }

    /// About 85% of the screen, so the next column peeks in, within 280 to 340 points. Larger text widens the cap,
    /// and accessibility sizes take nearly the whole width so titles and chips are not squeezed.
    private static func columnWidth(_ available: CGFloat, typeSize: DynamicTypeSize) -> CGFloat {
        #if os(macOS)
        // The Mac design's fixed 272pt column; the board scrolls sideways.
        return 272
        #else
        if typeSize.isAccessibilitySize { return available * 0.94 }
        let cap: CGFloat = typeSize >= .xxLarge ? 400 : 340
        return min(max(available * 0.85, 280), cap)
        #endif
    }

    var body: some View {
        let plan = self.plan
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(columns, id: \.bucket.localId) { column in
                    KanbanColumnView(
                        services: services,
                        view: view,
                        column: column,
                        columns: columns,
                        cards: cards(of: column, in: plan),
                        expanded: $expandedCards,
                        labels: live.value.labels,
                        subtaskInfo: live.value.subtaskInfo,
                        readOnly: readOnly,
                        compact: collapsesColumns && (sortByDue || hoverColumn != column.bucket.localId),
                        onDragStart: { beginDrag(from: column.bucket.localId) },
                        onOver: { columnOver(column.bucket.localId, $0) },
                        onDragEnd: { endDrag() },
                        onDrop: { taskId, beforeId in
                            endDrag()
                            drop(taskId, into: column, before: beforeId)
                        },
                        onMoveTo: { taskId, target in drop(taskId, into: target, before: nil) },
                        onEdit: { editing = BucketEdit(bucket: column.bucket, canDelete: columns.count > 1) },
                        onSetRole: { role in setRole(role, of: column.bucket) }
                    )
                    .containerRelativeFrame(.horizontal) { length, _ in width(length) }
                }
                if !readOnly && !collapsesColumns { addBucketButton }
            }
            .scrollTargetLayout()
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.hidden)
        .animation(.snappy(duration: 0.25), value: dragging)
        .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in endStaleDrag() })
        .background(Color(.grouped))
        .safeAreaInset(edge: .bottom, spacing: 0) { notices(hidden: plan.hiddenCount) }
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
        .errorHaptic(failure)
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

    @ViewBuilder private func notices(hidden hiddenCount: Int) -> some View {
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

// MARK: Drag state

extension KanbanBoardView {
    /// Columns shrink to headers while a card is dragged out of its own column. A touch behaviour: the Mac has room
    /// for every column and a pointer to aim with.
    private var collapsesColumns: Bool {
        #if os(macOS)
        false
        #else
        dragging && leftSource
        #endif
    }

    /// While a card is dragged every column shares the screen, so any of them can be reached without scrolling.
    private func width(_ available: CGFloat) -> CGFloat {
        guard collapsesColumns else { return Self.columnWidth(available, typeSize: typeSize) }
        let count = CGFloat(max(columns.count, 1))
        return max(88, (available - 32 - 12 * (count - 1)) / count)
    }

    /// The cards a column draws: its own order, or soonest due first when that setting is on.
    private func cards(of column: KanbanColumn, in plan: KanbanBoardPlan) -> [KanbanCardPlan] {
        let cards = plan.column(column.bucket.localId).cards
        return sortByDue ? KanbanSort.byDueDate(cards) : cards
    }

    private var sortByDue: Bool { preferences.custom.kanbanSortByDue }

    private func beginDrag(from columnId: String) {
        let started = Date.now
        dragStartedAt = started
        dragSource = columnId
        // With the cards in due-date order there is nothing to reorder, so go straight to choosing a column.
        leftSource = sortByDue
        sourceWasTargeted = false
        hoverColumn = nil
        dragging = true
        // Backstop for a drag that ends with no event at all (dropped outside the board): see `endStaleDrag`.
        Task {
            try? await Task.sleep(for: .seconds(30))
            if dragStartedAt == started { endDrag() }
        }
    }

    private func endDrag() {
        dragging = false
        dragSource = nil
        leftSource = false
        sourceWasTargeted = false
        hoverColumn = nil
        dragStartedAt = nil
    }

    /// A column reports the dragged card entering or leaving it. Leaving the column it came from, or entering another,
    /// switches from reordering to choosing a column.
    private func columnOver(_ id: String, _ isOver: Bool) {
        guard dragging else { return }
        if isOver {
            hoverColumn = id
            if id == dragSource { sourceWasTargeted = true } else { leftSource = true }
        } else {
            if hoverColumn == id { hoverColumn = nil }
            if id == dragSource && sourceWasTargeted { leftSource = true }
        }
    }

    /// A drag that was cancelled (dropped on nothing) sends no event, so the next touch on the board ends it. Not within
    /// a second of the start: that is the touch that lifted the card.
    private func endStaleDrag() {
        guard dragging, let started = dragStartedAt, Date.now.timeIntervalSince(started) > 1 else { return }
        endDrag()
    }
}

/// The board's columns, plus each card's labels for the chips.
struct KanbanBoardData: Equatable, Sendable {
    var columns: [KanbanColumn] = []
    var labels: [String: [LabelRecord]] = [:]
    /// Every label, for the filter's label choices.
    var allLabels: [LabelRecord] = []
    /// Parent local id to its subtasks' local ids, for nesting subtasks inside their parent's card.
    var children: [String: [String]] = [:]
    /// Each card's parent title and subtask progress, wherever the parent or subtasks are.
    var subtaskInfo = KanbanSubtaskInfo()

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

/// Every board task's parent title and every parent's subtask progress, read across projects, so a card can say whose
/// subtask it is even when the parent is not on the board, and a parent can show how many of its subtasks are done.
struct KanbanSubtaskInfo: Equatable, Sendable {
    var parentTitles: [String: String] = [:]
    var progress: [String: SubtaskProgress] = [:]

    static func read(_ reading: CriaStore, tasks: [TaskRecord]) throws -> KanbanSubtaskInfo {
        let byId = Dictionary(tasks.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        var info = KanbanSubtaskInfo()
        var looked: [String: TaskRecord?] = [:]
        func record(_ id: String) throws -> TaskRecord? {
            if let known = byId[id] { return known }
            if let cached = looked[id] { return cached }
            let found = try reading.task(localId: id)
            looked.updateValue(found, forKey: id)
            return found
        }
        for (parent, kids) in try reading.subtaskMap().sorted(by: { $0.key < $1.key }) {
            let kids = Set(kids).subtracting([parent])
            if byId[parent] != nil {
                var done = 0
                var total = 0
                for kid in kids {
                    guard let task = try record(kid) else { continue }
                    total += 1
                    if task.done { done += 1 }
                }
                if total > 0 { info.progress[parent] = SubtaskProgress(done: done, total: total) }
            }
            for kid in kids where byId[kid] != nil && info.parentTitles[kid] == nil {
                if let title = try record(parent)?.title { info.parentTitles[kid] = title }
            }
        }
        return info
    }
}
