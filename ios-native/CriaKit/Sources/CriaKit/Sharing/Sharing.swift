import Foundation

/// Vikunja permission levels: 0 read, 1 read and write, 2 admin.
public enum SharePermission: Int, CaseIterable, Sendable {
    case read = 0
    case write = 1
    case admin = 2

    public var label: String {
        switch self {
        case .read: "Read only"
        case .write: "Read & write"
        case .admin: "Admin"
        }
    }
}

public struct UserShare: Equatable, Sendable, Identifiable {
    public let serverId: Int
    public let username: String
    public let name: String?
    public let permission: SharePermission
    public var id: Int { serverId }

    /// Nil unless the row has a numeric id and a username.
    init?(_ row: JSONValue) {
        guard let serverId = row["id"]?.intValue, let username = row["username"]?.stringValue, !username.isEmpty else { return nil }
        self.serverId = serverId
        self.username = username
        name = row["name"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        permission = SharePermission(rawValue: row["permission"]?.intValue ?? 0) ?? .read
    }
}

public struct TeamShare: Equatable, Sendable, Identifiable {
    public let serverId: Int
    public let name: String
    public let permission: SharePermission
    public var id: Int { serverId }

    init?(_ row: JSONValue) {
        guard let serverId = row["id"]?.intValue else { return nil }
        self.serverId = serverId
        name = row["name"]?.stringValue ?? ""
        permission = SharePermission(rawValue: row["permission"]?.intValue ?? 0) ?? .read
    }
}

public struct LinkShare: Equatable, Sendable, Identifiable {
    public let id: Int
    public let hash: String
    public let name: String?
    public let permission: SharePermission
    public let hasPassword: Bool
    public let sharedByName: String?

    init?(_ row: JSONValue) {
        guard let id = row["id"]?.intValue, let hash = row["hash"]?.stringValue, !hash.isEmpty else { return nil }
        self.id = id
        self.hash = hash
        name = row["name"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        permission = SharePermission(rawValue: row["permission"]?.intValue ?? 0) ?? .read
        hasPassword = row["sharing_type"]?.intValue == 2
        let sharer = row["shared_by"]
        let display = sharer?["name"]?.stringValue ?? ""
        sharedByName = display.isEmpty ? sharer?["username"]?.stringValue : display
    }
}

public struct Team: Equatable, Sendable, Identifiable {
    public let serverId: Int
    public let name: String
    public let description: String?
    public let isPublic: Bool
    public let members: [TeamMember]
    public var id: Int { serverId }

    init?(_ row: JSONValue) {
        guard let serverId = row["id"]?.intValue else { return nil }
        self.serverId = serverId
        isPublic = row["is_public"]?.boolValue ?? false
        name = row["name"]?.stringValue ?? ""
        description = row["description"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        members = (row["members"]?.arrayValue ?? []).compactMap(TeamMember.init)
    }
}

public struct TeamMember: Equatable, Sendable, Identifiable {
    public let serverId: Int
    public let username: String
    public let name: String?
    public let admin: Bool
    public var id: Int { serverId }

    init?(_ row: JSONValue) {
        guard let serverId = row["id"]?.intValue, let username = row["username"]?.stringValue, !username.isEmpty else { return nil }
        self.serverId = serverId
        self.username = username
        name = row["name"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        admin = row["admin"]?.boolValue ?? false
    }
}

/// Ported from `src/lib/shareInput.ts` and `src/lib/shareUrl.ts`.
public enum ShareLinks {
    /// The link-share hash in a full share URL (`{base}/share/{hash}[/auth]`) or a bare hash. Nil when neither.
    public static func parseInput(_ input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        if let range = trimmed.range(of: #"/share/([A-Za-z0-9]+)(?:/auth)?(?:[?#]|$)"#, options: .regularExpression) {
            let match = String(trimmed[range])
            let tail = match.dropFirst("/share/".count)
            return String(tail.prefix { $0.isLetter || $0.isNumber })
        }
        let bare = trimmed.range(of: "^[A-Za-z0-9]+$", options: .regularExpression) != nil
        if bare && !["http", "https"].contains(trimmed.lowercased()) { return trimmed }
        return nil
    }

    /// Public URL for a link share: prefers the server's `frontend_url`, else the API URL without `/api/v1`.
    public static func url(serverURL: String, frontendURL: String?, hash: String) -> String {
        let frontend = frontendURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let derived = serverURL.replacingOccurrences(of: #"/api/v1/?$"#, with: "", options: .regularExpression)
        var base = frontend.isEmpty ? derived : frontend
        while base.hasSuffix("/") { base.removeLast() }
        return "\(base)/share/\(hash)/auth"
    }
}
