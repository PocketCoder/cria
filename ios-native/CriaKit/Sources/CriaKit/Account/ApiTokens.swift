import Foundation

public struct PermissionOption: Equatable, Sendable {
    public let id: String
    public let label: String
}

public struct PermissionGroup: Equatable, Sendable {
    public let group: String
    public let permissions: [PermissionOption]
}

/// Ported from `src/lib/apiTokenPermissions.ts`.
public enum ApiTokenPermissions {
    private static let standard: [(id: String, label: String)] = [
        ("read_all", "Read all"), ("create", "Create"), ("update", "Update"), ("delete", "Delete")
    ]

    /// Permission groups from the `/routes` response, sorted by group name. Each group gets the four standard
    /// permissions. Accepts the array shape the TS client types and the plain object the server sends.
    public static func groups(fromRoutes routes: JSONValue) -> [PermissionGroup] {
        var seen = Set<String>()
        var keys: [String] = []
        let entries: [JSONValue] = routes.arrayValue ?? [routes]
        for entry in entries {
            for key in (entry.objectValue ?? [:]).keys.sorted() where seen.insert(key).inserted {
                keys.append(key)
            }
        }
        return keys.sorted { $0.localizedCompare($1) == .orderedAscending }.map { key in
            PermissionGroup(group: key, permissions: standard.map { PermissionOption(id: "\(key):\($0.id)", label: $0.label) })
        }
    }

    /// `["tasks:read_all", "tasks:create"]` becomes `["tasks": ["read_all", "create"]]`. Ids without a colon are dropped.
    public static func permissions(fromSelection selected: [String]) -> [String: [String]] {
        var result: [String: [String]] = [:]
        for identifier in selected {
            guard let colon = identifier.firstIndex(of: ":") else { continue }
            let group = String(identifier[..<colon])
            let permission = String(identifier[identifier.index(after: colon)...])
            result[group, default: []].append(permission)
        }
        return result
    }
}

public struct ApiToken: Equatable, Sendable, Identifiable {
    public let id: Int
    public let title: String
    /// Only present in the create response; the server never shows it again.
    public let token: String?
    public let created: String?
    public let expiresAt: String?

    init?(_ row: JSONValue) {
        guard let id = row["id"]?.intValue else { return nil }
        self.id = id
        title = row["title"]?.stringValue ?? ""
        token = row["token"]?.stringValue
        created = row["created"]?.stringValue
        expiresAt = normaliseDate(row["expires_at"]?.stringValue)
    }
}

public extension ApiClient {
    func apiTokens() async throws -> [ApiToken] {
        let rows: [JSONValue]? = try await get("/tokens")
        return (rows ?? []).compactMap(ApiToken.init)
    }

    /// `expiresAt` is an ISO 8601 string. `permissions` come from `ApiTokenPermissions.permissions(fromSelection:)`.
    func createApiToken(title: String, expiresAt: String, permissions: [String: [String]]) async throws -> ApiToken? {
        let body: JSONBody = [
            "title": .string(title),
            "expires_at": .string(expiresAt),
            "permissions": .object(permissions.mapValues { JSONValue.array($0.map { JSONValue.string($0) }) })
        ]
        let row: JSONValue = try await put("/tokens", body: body)
        return ApiToken(row)
    }

    func deleteApiToken(id: Int) async throws {
        try await perform(.delete, "/tokens/\(id)")
    }

    func apiRoutes() async throws -> JSONValue {
        try await get("/routes")
    }

    func changePassword(old oldPassword: String, new newPassword: String) async throws {
        let body: JSONBody = ["old_password": .string(oldPassword), "new_password": .string(newPassword)]
        try await perform(.post, "/user/password", body: body)
    }
}
