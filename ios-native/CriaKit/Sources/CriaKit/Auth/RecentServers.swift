import Foundation

/// Servers signed in to before, newest first, and the username to prefill for each when "Remember me" was on. Only
/// ever the username: the password stays out of it. Ported from `recentServers` in `src/stores/settings.ts`.
public struct RecentServers {
    public static let serversKey = "cria.login.recentServers"
    public static let usernamesKey = "cria.login.usernames"
    public static let limit = 5

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func servers() -> [String] {
        defaults.stringArray(forKey: Self.serversKey) ?? []
    }

    public func username(for server: String) -> String? {
        (defaults.dictionary(forKey: Self.usernamesKey) as? [String: String])?[server]
    }

    /// Moves `server` to the front (no repeats, at most `limit`). A username is kept for it; without one, any
    /// username saved earlier for that server is forgotten. Servers pushed off the end lose their username too.
    public func remember(server: String, username: String?) {
        let list = Array(([server] + servers().filter { $0 != server }).prefix(Self.limit))
        defaults.set(list, forKey: Self.serversKey)
        var names = (defaults.dictionary(forKey: Self.usernamesKey) as? [String: String]) ?? [:]
        names[server] = username.flatMap { $0.isEmpty ? nil : $0 }
        names = names.filter { list.contains($0.key) }
        defaults.set(names, forKey: Self.usernamesKey)
    }

    public func forget(server: String) {
        defaults.set(servers().filter { $0 != server }, forKey: Self.serversKey)
        var names = (defaults.dictionary(forKey: Self.usernamesKey) as? [String: String]) ?? [:]
        names[server] = nil
        defaults.set(names, forKey: Self.usernamesKey)
    }
}
