import CriaKit
import SwiftUI

/// A project with its views: the project's name as a large title, an open count and a row of view pills under
/// it, then the selected view. List-shaped views carry the header in their scroll content (like Today); the board
/// and the timeline pin it above.
struct ProjectScreen: View {
    let services: AppServices
    let projectLocalId: String
    let title: String
    @State private var live: LiveValue<ProjectScreenData>
    @State private var selectedId: String?
    @State private var managing = false

    init(services: AppServices, projectLocalId: String, title: String) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.title = title
        let store = services.store
        _live = State(initialValue: LiveValue(initial: ProjectScreenData()) {
            observeStore(store, kinds: [.views, .projects, .tasks]) { reading in
                try ProjectScreenData(
                    views: reading.views(forProject: projectLocalId),
                    project: reading.project(localId: projectLocalId),
                    openCount: reading.tasks(matching: TaskQuery(projectLocalId: projectLocalId, includeDone: false)).count
                )
            }
        })
    }

    private var views: [ViewRecord] { live.value.views }

    private var current: ViewRecord? {
        views.first { $0.localId == selectedId } ?? views.first
    }

    private var canManage: Bool {
        ViewManagement.canManageViews(projectServerId: live.value.project?.serverId)
    }

    private var header: ProjectHeader {
        ProjectHeader(
            views: views,
            selectedId: current?.localId,
            colour: Color(hexString: live.value.project?.hexColor),
            openCount: live.value.openCount,
            canManage: canManage,
            onSelect: { id in withAnimation(.snappy) { selectedId = id } },
            onManage: { managing = true }
        )
    }

    var body: some View {
        content
            .navigationTitle(live.value.project?.title ?? title)
            .navigationBarTitleDisplayMode(.large)
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
                PinnedProjectHeader(header: header) {
                    KanbanBoardView(services: services, view: view)
                }
                .id(view.localId)
            case .table:
                TableViewScreen(services: services, projectLocalId: projectLocalId, header: header).id(view.localId)
            case .gantt:
                PinnedProjectHeader(header: header) {
                    GanttScreen(services: services, projectLocalId: projectLocalId)
                }
                .id(view.localId)
            case .list:
                ProjectListView(services: services, projectLocalId: projectLocalId, header: header).id(view.localId)
            }
        } else {
            ProjectListView(services: services, projectLocalId: projectLocalId, header: header)
        }
    }
}
