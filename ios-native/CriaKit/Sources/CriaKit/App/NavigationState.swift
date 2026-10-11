import Foundation

/// The four tabs of the iOS shell (`src/features/shell/TabBar.tsx`).
public enum AppTab: String, CaseIterable, Sendable {
    case today, upcoming, browse, search
}

/// Where a navigation push can go. Ids are local ids except saved filters, which are server-only.
public enum Route: Hashable, Sendable {
    case project(String)
    case task(String)
    case favorites
    case inbox
    case label(String)
    case savedFilter(Int)
}

/// Tab selection plus one navigation path per tab, so switching tabs keeps each tab's stack.
public struct NavigationState: Equatable, Sendable {
    public var selected: AppTab
    public private(set) var paths: [AppTab: [Route]]

    public init(selected: AppTab = .today, paths: [AppTab: [Route]] = [:]) {
        self.selected = selected
        self.paths = paths
    }

    public func path(for tab: AppTab) -> [Route] {
        paths[tab] ?? []
    }

    public mutating func setPath(_ path: [Route], for tab: AppTab) {
        paths[tab] = path.isEmpty ? nil : path
    }

    /// Pushes on the given tab (default: the selected one).
    public mutating func push(_ route: Route, on tab: AppTab? = nil) {
        let target = tab ?? selected
        paths[target] = path(for: target) + [route]
    }

    /// Opens a route from anywhere (a search hit, a notification): selects the tab and shows the route on a fresh stack.
    public mutating func open(_ route: Route, on tab: AppTab) {
        selected = tab
        paths[tab] = [route]
    }
}
