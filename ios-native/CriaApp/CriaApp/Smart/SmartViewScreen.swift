import CriaKit
import SwiftUI

/// A smart view (Today, Upcoming, Inbox or a saved filter): sections of tasks that update from the database.
struct SmartViewScreen: View {
    let services: AppServices
    let title: String
    @State private var live: LiveValue<[TaskGroup]>

    init(services: AppServices, view: SmartView, title: String) {
        self.services = services
        self.title = title
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks, .labels, .projects, .savedFilters]) { reading in
                try reading.smartGroups(view)
            }
        })
    }

    private var isEmpty: Bool { live.value.allSatisfy { $0.items.isEmpty } }

    var body: some View {
        List {
            ForEach(live.value, id: \.key) { group in
                if !group.items.isEmpty {
                    Section(group.label) {
                        ForEach(group.items, id: \.task.localId) { item in
                            TaskRowLink(services: services, item: item, showProject: true)
                        }
                    }
                }
            }
        }
            .criaSurface()
        .overlay {
            if isEmpty { ContentUnavailableView("Nothing here", systemImage: "checkmark.circle") }
        }
        .navigationTitle(title)
        .refreshable { await services.refresh() }
        .quickAdd(services: services)
        .task { await live.run() }
    }
}

/// Inbox needs the default project id from the server, so it is fetched on appear.
struct InboxScreen: View {
    let services: AppServices
    @State private var projectId: Int?
    @State private var didLoad = false

    var body: some View {
        Group {
            if didLoad {
                SmartViewScreen(services: services, view: .inbox(defaultProjectServerId: projectId), title: "Inbox")
            } else {
                ProgressView()
            }
        }
        .task {
            projectId = await services.defaultProjectServerId()
            didLoad = true
        }
    }
}

/// A saved filter's title comes from the local row.
struct SavedFilterScreen: View {
    let services: AppServices
    let serverId: Int

    var body: some View {
        let title = (try? services.store.savedFilter(serverId: serverId))?.title ?? "Filter"
        SmartViewScreen(services: services, view: .savedFilter(serverId: serverId), title: title)
    }
}
