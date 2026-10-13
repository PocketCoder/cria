import CriaKit
import SwiftUI

enum MacSelection: Hashable {
    case inbox, today, upcoming, favorites
    case project(String)
}

/// A sidebar of lists and, beside it, the shared screens in a navigation stack (task rows push the shared task
/// detail). Phase 2 replaces this with the three-column shell, menus and shortcuts.
struct MacShellView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var selection: MacSelection? = .today
    @State private var navigation = NavigationModel()
    @State private var undoCenter = UndoCenter()
    @State private var projects: LiveValue<[ProjectTreeRow]>
    @State private var showingSettings = false

    init(services: AppServices, onSignOut: @escaping (_ wipeLocalData: Bool) -> Void) {
        self.services = services
        self.onSignOut = onSignOut
        let store = services.store
        _projects = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.projects]) { (reading: CriaStore) throws -> [ProjectTreeRow] in
                ProjectTree.rows(ProjectTree.visible(try reading.projects()))
            }
        })
    }

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            NavigationStack(path: navigation.pathBinding(for: .browse)) {
                root
                    .navigationDestination(for: Route.self) { MacRouteDestination(route: $0, services: services) }
            }
            .id(selection)
        }
        .environment(navigation)
        .environment(undoCenter)
        .task { await projects.run() }
        .task { undoCenter.attach(services) }
        .sheet(isPresented: $showingSettings) {
            SettingsView(services: services, onSignOut: onSignOut).frame(minWidth: 520, minHeight: 600)
        }
    }

    @ViewBuilder
    private var root: some View {
        switch selection ?? .today {
        case .inbox: InboxScreen(services: services)
        case .today: SmartViewScreen(services: services, view: .today, title: "Today")
        case .upcoming: SmartViewScreen(services: services, view: .upcoming, title: "Upcoming")
        case .favorites: TaskListView(services: services, source: .favorites, title: "Favourites")
        case .project(let localId):
            let title = (try? services.store.project(localId: localId))?.title ?? "Project"
            ProjectScreen(services: services, projectLocalId: localId, title: title)
        }
    }

    private var sidebar: some View {
        List(selection: $selection) {
            Label("Inbox", systemImage: "tray").tag(MacSelection.inbox)
            Label("Today", systemImage: "sun.max").tag(MacSelection.today)
            Label("Upcoming", systemImage: "calendar").tag(MacSelection.upcoming)
            Label("Favourites", systemImage: "star").tag(MacSelection.favorites)
            Section("Projects") {
                ForEach(projects.value, id: \.project.localId) { row in
                    Label(row.project.title, systemImage: "folder")
                        .padding(.leading, CGFloat(row.depth) * 12)
                        .tag(MacSelection.project(row.project.localId))
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        .safeAreaInset(edge: .bottom) {
            Button("Settings", systemImage: "gearshape") { showingSettings = true }
                .buttonStyle(.link).padding(8)
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
