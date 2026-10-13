import CriaKit

/// Titles and symbols for the tabs. Shared with the Mac target, which has no `ShellView`.
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
