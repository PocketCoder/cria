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
        .environment(\.services, services)
        .environment(navigation)
        .tint(Color(.primary))
    }

    private func tab(_ tab: AppTab, title: String, symbol: String) -> some View {
        NavigationStack(path: navigation.pathBinding(for: tab)) {
            TabRoot(tab: tab, onSignOut: onSignOut)
                .navigationDestination(for: Route.self) { route in
                    RouteDestination(route: route)
                }
        }
        .tabItem { Label(title, systemImage: symbol) }
        .tag(tab)
    }
}

/// Root screen of each tab. Replaced screen by screen in S-43, S-47 and S-48.
struct TabRoot: View {
    let tab: AppTab
    let onSignOut: () -> Void

    var body: some View {
        ContentUnavailableView(tab.rawValue.capitalized, systemImage: "hammer", description: Text("Coming in this phase."))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Sign out", action: onSignOut) }
            }
    }
}

struct RouteDestination: View {
    let route: Route

    var body: some View {
        ContentUnavailableView("Not built yet", systemImage: "hammer")
    }
}
