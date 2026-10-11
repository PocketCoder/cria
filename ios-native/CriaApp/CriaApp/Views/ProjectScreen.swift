import CriaKit
import SwiftUI

/// A project with its views: a switcher in the toolbar (segmented on wide screens, a menu on iPhone) and the
/// selected view's content below.
struct ProjectScreen: View {
    let services: AppServices
    let projectLocalId: String
    let title: String
    @State private var live: LiveValue<[ViewRecord]>
    @State private var selectedId: String?
    @State private var managing = false

    init(services: AppServices, projectLocalId: String, title: String) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.title = title
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.views, .projects]) { reading in
                try reading.views(forProject: projectLocalId)
            }
        })
    }

    private var views: [ViewRecord] { live.value }

    private var current: ViewRecord? {
        views.first { $0.localId == selectedId } ?? views.first
    }

    private var canManage: Bool {
        let serverId = (try? services.store.project(localId: projectLocalId))?.serverId
        return ViewManagement.canManageViews(projectServerId: serverId)
    }

    var body: some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if views.count > 1 {
                    switcher
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                        .frame(maxWidth: .infinity)
                        .background(Color(.grouped))
                }
            }
            .navigationTitle(title)
            .toolbar {
                if canManage {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Manage views", systemImage: "rectangle.3.group") { managing = true }
                    }
                }
            }
            .sheet(isPresented: $managing) {
                ManageViewsSheet(services: services, projectLocalId: projectLocalId, views: views) { deletedId in
                    selectedId = ViewManagement.viewAfterDelete(views.map(\.slot), deletedId: deletedId)
                }
            }
            .task { await live.run() }
    }

    @ViewBuilder private var content: some View {
        if let view = current {
            switch view.viewKind {
            case .kanban:
                KanbanBoardView(services: services, view: view).id(view.localId)
            case .table:
                TableViewScreen(services: services, projectLocalId: projectLocalId).id(view.localId)
            case .gantt:
                GanttScreen(services: services, projectLocalId: projectLocalId).id(view.localId)
            case .list:
                TaskListView(services: services, source: .project(projectLocalId), title: title).id(view.localId)
            }
        } else {
            TaskListView(services: services, source: .project(projectLocalId), title: title)
        }
    }

    private var switcher: some View {
        Picker("View", selection: Binding(get: { current?.localId ?? "" }, set: { selectedId = $0 })) {
            ForEach(views, id: \.localId) { Text(ViewManagement.label($0.slot)).tag($0.localId) }
        }
        .pickerStyle(.segmented)
    }
}
