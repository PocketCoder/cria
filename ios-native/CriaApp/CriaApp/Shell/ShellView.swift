import CriaKit
import SwiftUI

/// Signed-in shell: four tabs, each with its own navigation stack. On iOS 26 the system draws the glass tab
/// bar for a plain `TabView`; older versions get the standard bar.
struct ShellView: View {
    let services: AppServices
    let onSignOut: () -> Void
    @State private var navigation = NavigationModel()

    var body: some View {
        VStack(spacing: 0) {
            SyncBanner(services: services)
            TabView(selection: navigation.selection) {
                tab(.today, title: "Today", symbol: "calendar")
                tab(.upcoming, title: "Upcoming", symbol: "calendar.badge.clock")
                tab(.browse, title: "Browse", symbol: "square.grid.2x2")
                tab(.search, title: "Search", symbol: "magnifyingglass")
            }
        }
        .environment(navigation)
        .tint(Color(.primary))
    }

    private func tab(_ tab: AppTab, title: String, symbol: String) -> some View {
        NavigationStack(path: navigation.pathBinding(for: tab)) {
            TabRoot(tab: tab, services: services, onSignOut: onSignOut)
                .navigationDestination(for: Route.self) { route in
                    RouteDestination(route: route, services: services)
                }
        }
        .tabItem { Label(title, systemImage: symbol) }
        .tag(tab)
    }
}

/// Root screen of each tab. 
struct TabRoot: View {
    let tab: AppTab
    let services: AppServices
    let onSignOut: () -> Void

    var body: some View {
        switch tab {
        case .browse:
            BrowseView(services: services)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu("Account", systemImage: "person.circle") {
                            Button("Sign out", role: .destructive, action: onSignOut)
                        }
                    }
                }
        case .today:
            SmartViewScreen(services: services, view: .today, title: "Today")
        case .upcoming:
            SmartViewScreen(services: services, view: .upcoming, title: "Upcoming")
        case .search:
            SearchScreen(services: services)
        }
    }
}

/// Screens pushed from a tab. 
struct RouteDestination: View {
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
