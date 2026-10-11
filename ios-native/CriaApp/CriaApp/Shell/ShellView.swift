import CriaKit
import SwiftUI

/// A quick-add request from a `cria://add` link. Identifiable so a sheet can bind to it.
struct QuickAddRequest: Identifiable {
    let id = UUID()
    let title: String
}

/// Signed-in shell: four tabs, each with its own navigation stack. On iOS 26 the system draws the glass tab
/// bar for a plain `TabView`; older versions get the standard bar.
struct ShellView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @Binding var pendingURL: URL?
    @State private var navigation = NavigationModel()
    @State private var addRequest: QuickAddRequest?

    var body: some View {
        VStack(spacing: 0) {
            SyncBanner(services: services)
            tabs
        }
        .environment(navigation)
        .tint(Color(.primary))
        .onChange(of: pendingURL) { _, _ in openPendingURL() }
        .task { openPendingURL() }
        .sheet(item: $addRequest) { request in
            QuickAddSheet(services: services, contextProjectId: nil, initialLine: request.title)
        }
    }

    /// Three tabs plus a search-role tab: on iOS 26 the system detaches Search into its own glass circle. Tab
    /// needs iOS 18; iOS 17 keeps the plain tab items.
    @ViewBuilder private var tabs: some View {
        if #available(iOS 18, *) {
            TabView(selection: navigation.selection) {
                Tab("Today", systemImage: "calendar", value: AppTab.today) { stack(.today) }
                Tab("Upcoming", systemImage: "calendar.badge.clock", value: AppTab.upcoming) { stack(.upcoming) }
                Tab("Browse", systemImage: "square.grid.2x2", value: AppTab.browse) { stack(.browse) }
                Tab("Search", systemImage: "magnifyingglass", value: AppTab.search, role: .search) { stack(.search) }
            }
            .modifier(KeepTabBarVisible())
        } else {
            TabView(selection: navigation.selection) {
                stack(.today).tabItem { Label("Today", systemImage: "calendar") }.tag(AppTab.today)
                stack(.upcoming).tabItem { Label("Upcoming", systemImage: "calendar.badge.clock") }.tag(AppTab.upcoming)
                stack(.browse).tabItem { Label("Browse", systemImage: "square.grid.2x2") }.tag(AppTab.browse)
                stack(.search).tabItem { Label("Search", systemImage: "magnifyingglass") }.tag(AppTab.search)
            }
        }
    }

    /// Acts on a link that arrived from outside (widget, Spotlight, Shortcuts) and clears it.
    private func openPendingURL() {
        guard let url = pendingURL else { return }
        pendingURL = nil
        guard let link = DeepLink(url: url), let destination = try? link.destination(in: services.store) else { return }
        switch destination {
        case .open(let tab, let route?):
            navigation.state.open(route, on: tab)
        case .open(let tab, nil):
            navigation.state.selected = tab
            navigation.state.setPath([], for: tab)
        case .quickAdd(let title):
            addRequest = QuickAddRequest(title: title ?? "")
        }
    }

    private func stack(_ tab: AppTab) -> some View {
        NavigationStack(path: navigation.pathBinding(for: tab)) {
            TabRoot(tab: tab, services: services, onSignOut: onSignOut)
                .navigationDestination(for: Route.self) { route in
                    RouteDestination(route: route, services: services)
                }
        }
    }
}

/// Keeps the tab bar visible on iOS 26 so the floating + button has a stable anchor.
private struct KeepTabBarVisible: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.tabBarMinimizeBehavior(.never)
        } else {
            content
        }
    }
}

/// Root screen of each tab. 
struct TabRoot: View {
    let tab: AppTab
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var showingSettings = false

    var body: some View {
        switch tab {
        case .browse:
            BrowseView(services: services)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", systemImage: "gearshape") { showingSettings = true }
                    }
                }
                .sheet(isPresented: $showingSettings) {
                    SettingsView(services: services, onSignOut: onSignOut)
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
