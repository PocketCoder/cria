import CriaKit
import SwiftUI

/// Three columns: sidebar, the shared screens for the selection, and the open task. Task rows select into the detail
/// column (through `taskOpener`) instead of pushing.
struct MacShellView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var actions = MacActions()
    @State private var navigation = NavigationModel()
    @State private var undoCenter = UndoCenter()
    @State private var keys = KeySequencer()

    var body: some View {
        NavigationSplitView(columnVisibility: $actions.columns) {
            MacSidebar(services: services, actions: actions)
        } content: {
            content
        } detail: {
            NavigationStack {
                if let id = actions.openTaskId {
                    TaskDetailView(services: services, taskLocalId: id).id(id)
                } else {
                    ContentUnavailableView("No task selected", systemImage: "checklist")
                }
            }
        }
        .focusable()
        .focusEffectDisabled()
        .onKeyPress { keys.handle($0, actions: actions) }
        .focusedSceneValue(\.macActions, actions)
        .environment(navigation)
        .environment(undoCenter)
        .overlay(alignment: .bottom) { UndoToast(center: undoCenter) }
        .task { undoCenter.attach(services) }
        .sheet(item: $actions.addRequest) { request in
            QuickAddSheet(services: services, contextProjectId: contextProject, initialLine: request.title)
        }
        .sheet(isPresented: $actions.creatingProject) {
            ProjectEditorSheet(services: services, target: .create, projects: (try? services.store.projects()) ?? [])
        }
        .sheet(isPresented: $actions.showingPalette) { CommandPalette(services: services, actions: actions) }
        .sheet(isPresented: $actions.showingShortcuts) { ShortcutsHelp() }
    }

    /// New tasks go to the project on screen.
    private var contextProject: String? {
        if case .project(let id)? = actions.selection { return id }
        return nil
    }

    private var content: some View {
        NavigationStack(path: navigation.pathBinding(for: .browse)) {
            root
                .navigationDestination(for: Route.self) { MacRouteDestination(route: $0, services: services) }
        }
        .environment(\.taskOpener) { actions.openTaskId = $0 }
        .environment(\.selectedTaskId, actions.openTaskId)
        .id(actions.selection)
        .navigationSplitViewColumnWidth(min: 320, ideal: 440)
    }

    @ViewBuilder
    private var root: some View {
        switch actions.selection ?? .today {
        case .inbox: InboxScreen(services: services)
        case .today: SmartViewScreen(services: services, view: .today, title: "Today")
        case .upcoming: SmartViewScreen(services: services, view: .upcoming, title: "Upcoming")
        case .favorites: TaskListView(services: services, source: .favorites, title: "Favourites")
        case .search: SearchScreen(services: services)
        case .project(let localId):
            let title = (try? services.store.project(localId: localId))?.title ?? "Project"
            ProjectScreen(services: services, projectLocalId: localId, title: title)
        case .savedFilter(let serverId): SavedFilterScreen(services: services, serverId: serverId)
        }
    }
}

/// Screens pushed from a list: a copy of the iOS `RouteDestination`, which lives in the excluded iOS shell.
struct MacRouteDestination: View {
    let route: Route
    let services: AppServices

    var body: some View {
        switch route {
        case .project(let localId):
            let title = (try? services.store.project(localId: localId))?.title ?? "Project"
            ProjectScreen(services: services, projectLocalId: localId, title: title)
        case .favorites:
            TaskListView(services: services, source: .favorites, title: "Favourites")
        case .label(let localId):
            let title = (try? services.store.labels())?.first { $0.localId == localId }?.title ?? "Label"
            TaskListView(services: services, source: .label(localId), title: title)
        case .task(let localId):
            TaskDetailView(services: services, taskLocalId: localId)
        case .inbox:
            InboxScreen(services: services)
        case .savedFilter(let serverId):
            SavedFilterScreen(services: services, serverId: serverId)
        }
    }
}
