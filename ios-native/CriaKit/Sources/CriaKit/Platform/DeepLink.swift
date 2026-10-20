import Foundation

/// `cria://` links: widgets, Spotlight, Shortcuts and other apps. A numeric id is a server id (it means the same on
/// every device); anything else is a local id, valid on this device only.
///
/// - `cria://task/{id}`, `cria://project/{id}`
/// - `cria://today`, `cria://upcoming`, `cria://inbox`, `cria://search`
/// - `cria://add?title=Buy%20milk` opens quick add with the title filled in
public enum DeepLink: Equatable, Sendable {
    public static let scheme = "cria"

    case task(String)
    case project(String)
    case today
    case upcoming
    case inbox
    case search
    case add(title: String?)

    public init?(url: URL) {
        guard url.scheme?.lowercased() == Self.scheme, let host = url.host?.lowercased() else { return nil }
        let identifier = url.pathComponents.dropFirst().first.flatMap { $0.isEmpty || $0 == "/" ? nil : $0 }
        switch host {
        case "task": self = identifier.map(DeepLink.task) ?? .today
        case "project": self = identifier.map(DeepLink.project) ?? .inbox
        case "today": self = .today
        case "upcoming": self = .upcoming
        case "inbox": self = .inbox
        case "search": self = .search
        case "add":
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            self = .add(title: items?.first { $0.name == "title" }?.value)
        default: return nil
        }
    }

    public static func taskURL(localId: String) -> URL? { URL(string: "\(scheme)://task/\(localId)") }
    public static func projectURL(localId: String) -> URL? { URL(string: "\(scheme)://project/\(localId)") }
    public static var todayURL: URL? { URL(string: "\(scheme)://today") }
    /// Opens quick add, as the widgets' "Add task" button and the Control Centre control do.
    public static var addURL: URL? { URL(string: "\(scheme)://add") }

    /// Where the link goes in the shell.
    public enum Destination: Equatable, Sendable {
        case open(tab: AppTab, route: Route?)
        case quickAdd(title: String?)
    }

    /// Resolves ids against the local store. A link to something not synced yet falls back to the Today tab.
    public func destination(in store: CriaStore) throws -> Destination {
        switch self {
        case .today: return .open(tab: .today, route: nil)
        case .upcoming: return .open(tab: .upcoming, route: nil)
        case .search: return .open(tab: .search, route: nil)
        case .inbox: return .open(tab: .browse, route: .inbox)
        case .add(let title): return .quickAdd(title: title)
        case .task(let identifier):
            guard let localId = try store.resolveTaskId(identifier) else { return .open(tab: .today, route: nil) }
            return .open(tab: .browse, route: .task(localId))
        case .project(let identifier):
            guard let localId = try store.resolveProjectId(identifier) else { return .open(tab: .browse, route: nil) }
            return .open(tab: .browse, route: .project(localId))
        }
    }
}
