import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// A project with its views: the project's name as a large title, an open count and a row of view pills under
/// it, then the selected view. List-shaped views carry the header in their scroll content (like Today); the board
/// and the timeline pin it above. A project background shows as a banner in the header.
struct ProjectScreen: View {
    let services: AppServices
    let projectLocalId: String
    let title: String
    @State private var live: LiveValue<ProjectScreenData>
    @State private var selectedId: String?
    @State private var managing = false
    @State private var showingInfo = false
    @State private var background: PlatformImage?
    /// Bumped when the background changes elsewhere, to reload it.
    @State private var backgroundRevision = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(services: AppServices, projectLocalId: String, title: String) {
        self.services = services
        self.projectLocalId = projectLocalId
        self.title = title
        // Opens on the view last used in this project, as Vikunja-web does (kept on this device).
        _selectedId = State(initialValue: ProjectViewMemory.remembered(projectLocalId: projectLocalId))
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
        ProjectViewMemory.choose(remembered: selectedId, among: views)
    }

    /// Switches view and remembers the choice for next time.
    private func select(_ localId: String?) {
        selectedId = localId
        if let localId { ProjectViewMemory.remember(localId, projectLocalId: projectLocalId) }
    }

    private var canManage: Bool {
        ViewManagement.canManageViews(projectServerId: live.value.project?.serverId)
    }

    /// The Info pill's action; none until the project has loaded.
    private var infoAction: (() -> Void)? {
        guard live.value.project != nil else { return nil }
        return { showingInfo = true }
    }

    private var header: ProjectHeader {
        ProjectHeader(
            views: views,
            selectedId: current?.localId,
            colour: Color(hexString: live.value.project?.hexColor),
            openCount: live.value.openCount,
            canManage: canManage,
            onSelect: { id in withAnimation(reduceMotion ? nil : .snappy) { select(id) } },
            onManage: { managing = true },
            onInfo: infoAction,
            background: background
        )
    }

    var body: some View {
        content
            .navigationTitle(live.value.project?.title ?? title)
            .navigationBarTitleDisplayMode(.large)
            .sheet(isPresented: $managing) {
                ManageViewsSheet(services: services, projectLocalId: projectLocalId, views: views) { deletedId in
                    select(ViewManagement.viewAfterDelete(views.map(\.slot), deletedId: deletedId))
                }
            }
            .sheet(isPresented: $showingInfo) {
                ProjectInfoSheet(services: services, projectLocalId: projectLocalId)
            }
            .task { await live.run() }
            .task(id: "\(live.value.project?.serverId ?? 0)-\(backgroundRevision)") { await loadBackground() }
            .onReceive(NotificationCenter.default.publisher(for: .criaProjectBackgroundChanged)) { note in
                if let serverId = note.object as? Int, serverId == live.value.project?.serverId { backgroundRevision += 1 }
            }
    }

    /// Cached copy first, then the server's; nothing for a project that has not synced yet.
    private func loadBackground() async {
        guard let serverId = live.value.project?.serverId else {
            background = nil
            return
        }
        await ProjectBackgroundLoader.load(services: services, serverId: serverId) { image in
            withAnimation(.easeOut(duration: 0.25)) { background = image }
        }
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
                TableViewScreen(services: services, projectLocalId: projectLocalId, viewLocalId: view.localId, header: header)
                    .id(view.localId)
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
