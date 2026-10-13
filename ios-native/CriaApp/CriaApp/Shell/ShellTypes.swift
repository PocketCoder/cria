import CriaKit
import Foundation

/// Types the iOS `ShellView` and the Mac shell both use: tab titles and symbols, tab counts, quick add requests.
extension AppTab {
    var title: String {
        switch self {
        case .today: return "Today"
        case .upcoming: return "Upcoming"
        case .browse: return "Browse"
        case .search: return "Search"
        case .inbox: return "Inbox"
        case .favorites: return "Favourites"
        }
    }

    var symbol: String {
        switch self {
        case .today: return "calendar"
        case .upcoming: return "calendar.badge.clock"
        case .browse: return "square.grid.2x2"
        case .search: return "magnifyingglass"
        case .inbox: return "tray"
        case .favorites: return "star"
        }
    }
}

/// Task counts for the tab badges.
struct TabCounts: Equatable, Sendable {
    var today = 0
    var inbox = 0

    static func read(_ store: CriaStore, inboxLocalId: String?) throws -> TabCounts {
        let today = try store.smartGroups(.today).reduce(0) { $0 + $1.items.count }
        let inbox = try inboxLocalId.map { try store.taskItems(.project($0), includeDone: false).count } ?? 0
        return TabCounts(today: today, inbox: inbox)
    }
}

/// A quick-add request from a `cria://add` link. Identifiable so a sheet can bind to it.
struct QuickAddRequest: Identifiable {
    let id = UUID()
    let title: String
}
