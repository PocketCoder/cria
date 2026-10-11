import CriaKit
import SwiftUI

/// A live task list for a project, favourites or label. Rows update from database changes.
struct TaskListView: View {
    let services: AppServices
    let source: TaskListSource
    let title: String
    @State private var live: LiveValue<[TaskListItem]>
    @AppStorage("cria.taskList.showDone") private var showDone = true

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

    private var visible: [TaskListItem] {
        showDone ? live.value : live.value.filter { !$0.task.done }
    }

    var body: some View {
        List {
            ForEach(visible, id: \.task.localId) { item in
                TaskRowLink(services: services, item: item, showProject: showsProject)
            }
        }
        .overlay {
            if visible.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "checklist", description: Text(emptyMessage))
            }
        }
        .navigationTitle(title)
        .refreshable { await services.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Options", systemImage: "ellipsis.circle") {
                    Toggle("Show completed", isOn: $showDone)
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
