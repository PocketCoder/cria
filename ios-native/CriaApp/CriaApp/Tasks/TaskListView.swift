import CriaKit
import SwiftUI

/// A live task list for a project, favourites or label. Rows update from database changes.
struct TaskListView: View {
    let services: AppServices
    let source: TaskListSource
    let title: String
    @State private var live: LiveValue<[TaskListItem]>
    @AppStorage("cria.taskList.showDone") private var showDone = true
    @AppStorage("cria.taskList.sort") private var sortIndex = 0
    @State private var optimistic = OptimisticOrder()

    init(services: AppServices, source: TaskListSource, title: String) {
        self.services = services
        self.source = source
        self.title = title
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { reading in
                try reading.taskItems(source, includeDone: true)
            }
        })
    }

    private var sortRule: SortRule? {
        TaskSort.options.indices.contains(sortIndex) ? TaskSort.options[sortIndex].rule : nil
    }

    /// Rows in display order: sorted by the chosen rule, then any pending drag order on top.
    private var visible: [TaskListItem] {
        let shown = showDone ? live.value : live.value.filter { !$0.task.done }
        let manual = ListReorder.isEnabled(sort: sortRule, hasFilter: false)
        guard !manual else { return applyOptimistic(shown) }
        let byId = Dictionary(shown.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return TaskSort.sorted(shown.map(\.task), by: sortRule).compactMap { byId[$0.localId] }
    }

    private func applyOptimistic(_ items: [TaskListItem]) -> [TaskListItem] {
        let byId = Dictionary(items.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        return optimistic.resolve(items.map(\.task.localId)).compactMap { byId[$0] }
    }

    private var canReorder: Bool {
        guard case .project = source else { return false }
        return ListReorder.isEnabled(sort: sortRule, hasFilter: false)
    }

    /// Moves a row, then writes the position. Done tasks stay put: only the open order is persisted.
    private func move(_ indices: IndexSet, _ destination: Int) {
        var rows = visible
        guard let first = indices.first, case .project(let projectId) = source else { return }
        let moved = rows[first].task
        guard !moved.done else { return }
        let stored = live.value.map(\.task.localId)
        rows.move(fromOffsets: indices, toOffset: destination)
        optimistic.set(rows.map(\.task.localId), over: showDone ? stored : live.value.filter { !$0.task.done }.map(\.task.localId))
        let openIds = rows.filter { !$0.task.done }.map(\.task.localId)
        guard let viewId = try? services.store.listViewLocalId(projectLocalId: projectId) else { return }
        try? services.store.applyListReorder(orderedIds: openIds, movedId: moved.localId, viewLocalId: viewId)
    }

    var body: some View {
        List {
            ForEach(visible, id: \.task.localId) { item in
                TaskRowLink(services: services, item: item, showProject: showsProject)
            }
            .onMove(perform: canReorder ? { move($0, $1) } : nil)
        }
            .criaSurface()
        .overlay {
            if visible.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "checklist", description: Text(emptyMessage))
            }
        }
        .navigationTitle(title)
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
                }
            }
        }
        .quickAdd(services: services, contextProjectId: contextProjectId)
        .task { await live.run() }
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

/// A task row that opens the detail screen, with the shared swipe actions: done, star and delete.
struct TaskRowLink: View {
    let services: AppServices
    let item: TaskListItem
    var showProject = false

    var body: some View {
        NavigationLink(value: Route.task(item.task.localId)) {
            TaskRowView(item: item, showProject: showProject) { toggle() }
        }
        .swipeActions(edge: .leading) {
            Button(item.task.done ? "Reopen" : "Done", systemImage: "checkmark") { toggle() }
                .tint(Color(.success))
        }
        .swipeActions(edge: .trailing) {
            Button("Delete", systemImage: "trash", role: .destructive) {
                try? services.store.deleteTask(localId: item.task.localId)
            }
            Button("Star", systemImage: "star") {
                let patch = TaskPatch(isFavorite: !item.task.isFavorite)
                _ = try? services.store.updateTask(localId: item.task.localId, patch: patch)
            }
            .tint(Color(.warning))
        }
    }

    private func toggle() {
        _ = try? services.store.updateTask(localId: item.task.localId, patch: TaskPatch(done: !item.task.done))
    }
}
