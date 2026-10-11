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

/// Root screen of each tab. Today, Upcoming and Search arrive in S-47 and S-48.
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
        default:
            ContentUnavailableView(tab.rawValue.capitalized, systemImage: "hammer", description: Text("Coming in this phase."))
        }
    }
}

/// Screens pushed from a tab. Task list and detail arrive in S-44 and S-45.
struct RouteDestination: View {
    let route: Route
    let services: AppServices

    var body: some View {
        ContentUnavailableView("Not built yet", systemImage: "hammer")
    }
}
