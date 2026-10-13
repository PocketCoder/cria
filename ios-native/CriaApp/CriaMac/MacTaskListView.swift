import CriaKit
import SwiftUI

/// The tasks for one sidebar selection, with a done checkbox on each row.
struct MacTaskListView: View {
    let services: AppServices
    let selection: MacSelection
    @Binding var taskId: String?
    @State private var live: LiveValue<[TaskListItem]>

    init(services: AppServices, selection: MacSelection, taskId: Binding<String?>) {
        self.services = services
        self.selection = selection
        _taskId = taskId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .labels, .projects]) { (reading: CriaStore) throws -> [TaskListItem] in
                try Self.read(reading, services: services, selection: selection)
            }
        })
    }

    var body: some View {
        List(live.value, id: \.task.localId, selection: $taskId) { item in
            HStack {
                Button {
                    try? services.store.updateTask(localId: item.task.localId, patch: TaskPatch(done: !item.task.done))
                } label: {
                    Image(systemName: item.task.done ? "checkmark.circle.fill" : "circle")
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.task.done ? "Mark not done" : "Mark done")
                Text(item.task.title).strikethrough(item.task.done)
            }
        }
        .overlay {
            if live.value.isEmpty { ContentUnavailableView("Nothing here", systemImage: "checkmark.circle") }
        }
        .navigationTitle(title)
        .task { await live.run() }
    }

    private var title: String {
        switch selection {
        case .inbox: "Inbox"
        case .today: "Today"
        case .upcoming: "Upcoming"
        case .project: "Tasks"
        }
    }

    private static func read(_ store: CriaStore, services: AppServices, selection: MacSelection) throws -> [TaskListItem] {
        switch selection {
        case .today: return try store.smartGroups(.today).flatMap(\.items)
        case .upcoming: return try store.smartGroups(.upcoming).flatMap(\.items)
        case .inbox:
            guard let projectId = services.rememberedDefaultProjectLocalId() else { return [] }
            return try store.taskItems(.project(projectId))
        case .project(let projectId): return try store.taskItems(.project(projectId))
        }
    }
}

/// Only the title, until a later phase builds the inspector.
struct MacTaskDetailView: View {
    let services: AppServices
    let taskId: String?
    @State private var title: String?

    var body: some View {
        Group {
            if let title {
                Text(title).font(.title2).padding()
            } else {
                ContentUnavailableView("Select a task", systemImage: "checklist")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: taskId) {
            title = taskId.flatMap { try? services.store.task(localId: $0)?.title }
        }
    }
}
