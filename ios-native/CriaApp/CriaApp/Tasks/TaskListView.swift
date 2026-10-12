import CriaKit
import SwiftUI

/// A live task list for a project, favourites or label. Rows update from database changes. Subtasks sit under their
/// parent when both are in the list, and a parent's children can be collapsed.
struct TaskListView: View {
    let services: AppServices
    let source: TaskListSource
    let title: String
    @State private var live: LiveValue<TaskListSnapshot>
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @AppStorage("cria.taskList.sort") private var sortIndex = 0
    @State private var optimistic = OptimisticOrder()
    @State private var failure: String?
    /// Parents whose subtasks are hidden, for this screen only.
    @State private var collapsed: Set<String> = []
    /// The label being edited from the toolbar, and its new title once saved (the route passes the old one).
    @State private var labelEditor: LabelEditTarget?
    @State private var renamedTitle: String?

    init(services: AppServices, source: TaskListSource, title: String) {
        self.services = services
        self.source = source
        self.title = title
        let store = services.store
        _live = State(initialValue: LiveValue(initial: TaskListSnapshot()) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try TaskListNesting.snapshot(reading, items: reading.taskItems(source, includeDone: true))
            }
        })
    }

    private var sortRule: SortRule? {
        TaskSort.options.indices.contains(sortIndex) ? TaskSort.options[sortIndex].rule : nil
    }

    /// Rows in display order: sorted by the chosen rule, then any pending drag order on top.
    private var visible: [TaskListItem] {
        let all = live.value.items
        let shown = showDone ? all : all.filter { !$0.task.done }
        let manual = ListReorder.isEnabled(sort: sortRule, hasFilter: false)
        guard !manual else { return applyOptimistic(shown) }
        let byId = Dictionary(shown.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return TaskSort.sorted(shown.map(\.task), by: sortRule).compactMap { byId[$0.localId] }
    }

    private func applyOptimistic(_ items: [TaskListItem]) -> [TaskListItem] {
        let byId = Dictionary(items.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return optimistic.resolve(items.map(\.task.localId)).compactMap { byId[$0] }
    }

    /// Rows nested under their parents, before collapsing.
    private var nested: [NestedTaskItem] { TaskTree.nest(visible, children: live.value.children) }

    /// Reordering is off while any subtask is nested: a drag would have to move whole subtrees.
    private var canReorder: Bool {
        guard case .project = source else { return false }
        return ListReorder.isEnabled(sort: sortRule, hasFilter: false) && !nested.contains(where: \.hasChildren)
    }

    /// Moves a row, then writes the position. Done tasks stay put: only the open order is persisted.
    private func move(_ indices: IndexSet, _ destination: Int) {
        var rows = visible
        guard let first = indices.first, case .project(let projectId) = source else { return }
        let moved = rows[first].task
        guard !moved.done else { return }
        let all = live.value.items
        let stored = all.map(\.task.localId)
        rows.move(fromOffsets: indices, toOffset: destination)
        optimistic.set(rows.map(\.task.localId), over: showDone ? stored : all.filter { !$0.task.done }.map(\.task.localId))
        let openIds = rows.filter { !$0.task.done }.map(\.task.localId)
        do {
            guard let viewId = try services.store.listViewLocalId(projectLocalId: projectId) else { return }
            try services.store.applyListReorder(orderedIds: openIds, movedId: moved.localId, viewLocalId: viewId)
        } catch {
            failure = String(describing: error)
        }
    }

    var body: some View {
        List {
            ForEach(TaskListNesting.visible(nested, collapsed: collapsed)) { row in
                TaskRowLink(
                    services: services, item: row.item, showProject: showsProject,
                    tree: TaskListNesting.tree(for: row, progress: live.value.progress, collapsed: $collapsed)
                )
            }
            .onMove(perform: canReorder ? { move($0, $1) } : nil)
        }
            .criaSurface()
        .overlay {
            if visible.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "checklist", description: Text(emptyMessage))
            }
        }
        .navigationTitle(renamedTitle ?? title)
        .refreshable { await services.refresh() }
        .toolbar {
            if canReorder {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Options", systemImage: "ellipsis.circle") {
                    Toggle("Show completed", isOn: $showDone)
                    Picker("Sort", selection: $sortIndex) {
                        ForEach(TaskSort.options.indices, id: \.self) { Text(TaskSort.options[$0].label).tag($0) }
                    }
                    if let labelLocalId {
                        Divider()
                        Button("Edit label", systemImage: "pencil") { editLabel(labelLocalId) }
                    }
                }
            }
        }
        .sheet(item: $labelEditor) { target in
            LabelEditorSheet(services: services, label: target.label) { renamedTitle = $0.title }
        }
        .quickAdd(services: services, contextProjectId: contextProjectId)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task { await live.run() }
    }

    private var labelLocalId: String? {
        if case .label(let localId) = source { return localId }
        return nil
    }

    private func editLabel(_ localId: String) {
        do {
            guard let label = try services.store.labels().first(where: { $0.localId == localId }) else { return }
            labelEditor = LabelEditTarget(label: label)
        } catch {
            failure = String(describing: error)
        }
    }

    private var contextProjectId: String? {
        if case .project(let localId) = source { return localId }
        return nil
    }

    private var emptyMessage: String {
        switch source {
        case .favorites: return "Star a task to see it here."
        case .label: return "No tasks carry this label."
        case .project: return "Nothing here yet."
        }
    }

    /// The project chip is redundant inside a project.
    private var showsProject: Bool {
        if case .project = source { return false }
        return true
    }
}

/// A task row that opens the detail screen. Each swipe does what Settings > Customise > Swipe actions says
/// (complete and delete by default). Delete goes straight through with an Undo toast (never a full swipe); failed
/// writes show an alert.
struct TaskRowLink: View {
    let services: AppServices
    let item: TaskListItem
    var showProject = false
    var tree = TaskRowTree()
    /// Optional so a row shown inside a sheet (no shell environment) still deletes, without the Undo toast.
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    @Environment(\.preferences) private var preferences
    @State private var failure: String?
    @State private var scheduling = false

    var body: some View {
        let swipes = preferences.custom
        NavigationLink(value: Route.task(item.task.localId)) {
            TaskRowView(item: item, showProject: showProject, tree: tree) { toggle() }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: swipes.swipeRight != .delete) { swipeButton(swipes.swipeRight) }
        .swipeActions(edge: .trailing, allowsFullSwipe: swipes.swipeLeft != .delete) { swipeButton(swipes.swipeLeft) }
        .sheet(isPresented: $scheduling) {
            DateSheet(
                title: "Date", iso: item.task.dueDate,
                repeatValue: RepeatValue(after: item.task.repeatAfter, mode: item.task.repeatMode)
            ) { iso, chosen in schedule(iso, repeatValue: chosen) }
        }
        .contextMenu {
            Button(item.task.done ? "Mark as not done" : "Complete", systemImage: "checkmark.circle") { toggle() }
            Button(item.task.isFavorite ? "Unstar" : "Star", systemImage: "star") { toggleStar() }
            Button("Due tomorrow", systemImage: "sunrise") { dueTomorrow() }
            Button("Schedule…", systemImage: "calendar") { scheduling = true }
            if let collapsed = tree.isCollapsed {
                Button(collapsed ? "Show subtasks" : "Hide subtasks", systemImage: "list.bullet.indent") {
                    tree.onToggleCollapsed()
                }
            }
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) { delete() }
        } preview: {
            TaskRowView(item: item, showProject: true) {}
                .padding()
                .frame(width: 360)
                .background(Color(.cell))
        }
        .accessibilityActions {
            if let collapsed = tree.isCollapsed {
                Button(collapsed ? "Show subtasks" : "Hide subtasks") { tree.onToggleCollapsed() }
            }
        }
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder
    private func swipeButton(_ action: SwipeAction) -> some View {
        switch action {
        case .none:
            EmptyView()
        case .complete:
            Button(item.task.done ? "Reopen" : "Done", systemImage: "checkmark") { toggle() }
                .tint(Color(.meadow500))
        case .schedule:
            Button("Schedule", systemImage: "calendar") { scheduling = true }
                .tint(Color(.sky500))
        case .star:
            Button(item.task.isFavorite ? "Unstar" : "Star", systemImage: "star") { toggleStar() }
                .tint(Color(.marigold500))
        case .delete:
            // Not `.destructive`: that role animates the row away before the write, even when it fails.
            Button("Delete", systemImage: "trash") { delete() }
                .tint(Color(.destructive))
        }
    }

    private func schedule(_ iso: String, repeatValue: RepeatValue?) {
        var patch = TaskPatch(dueDate: iso)
        if let repeatValue, repeatValue != RepeatValue(after: item.task.repeatAfter, mode: item.task.repeatMode) {
            patch.repeatAfter = repeatValue.after
            patch.repeatMode = repeatValue.mode
        }
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }

    private func attempt(_ work: () throws -> Void) {
        do {
            try work()
        } catch {
            failure = String(describing: error)
        }
    }

    private func delete() {
        attempt {
            if let undo {
                try undo.deleteTask(localId: item.task.localId, title: item.task.title)
            } else {
                try services.store.deleteTask(localId: item.task.localId)
            }
        }
    }

    private func toggleStar() {
        let patch = TaskPatch(isFavorite: !item.task.isFavorite)
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }

    private func dueTomorrow() {
        let day = Calendar.cria.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let patch = TaskPatch(dueDate: DueDates.allDayISO(for: day))
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }

    private func toggle() {
        let patch = TaskPatch(done: !item.task.done)
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }
}
