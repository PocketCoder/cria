import Foundation

/// A login session on the server (`GET /user/sessions`). Ported from `src/api/sessions.ts`.
public struct UserSession: Equatable, Sendable, Identifiable {
    public let id: String
    public let deviceInfo: String
    public let ipAddress: String
    public let lastActive: String?
    public let created: String?

    init?(_ row: JSONValue) {
        guard let id = row["id"]?.stringValue else { return nil }
        self.id = id
        deviceInfo = row["device_info"]?.stringValue ?? ""
        ipAddress = row["ip_address"]?.stringValue ?? ""
        lastActive = normaliseDate(row["last_active"]?.stringValue)
        created = normaliseDate(row["created"]?.stringValue)
    }

    var activeSeconds: TimeInterval { lastActive.flatMap(SessionDates.parse)?.timeIntervalSince1970 ?? 0 }

    /// "Safari on iPhone", from the User-Agent.
    public var deviceName: String { SessionRules.describeDevice(deviceInfo) }
}

/// The session list plus the bearer token the request went out with (its `sid` claim is this device's session).
public struct SessionListing: Sendable {
    public let sessions: [UserSession]
    public let currentId: String?
}

public enum SessionRules {
    /// Most recently active first; undated sessions sink. Stable for ties.
    public static func sorted(_ sessions: [UserSession]) -> [UserSession] {
        sessions.enumerated().sorted { lhs, rhs in
            lhs.element.activeSeconds == rhs.element.activeSeconds
                ? lhs.offset < rhs.offset : lhs.element.activeSeconds > rhs.element.activeSeconds
        }.map(\.element)
    }

    /// This device first, then the order given.
    public static func currentFirst(_ sessions: [UserSession], currentId: String?) -> [UserSession] {
        sessions.filter { $0.id == currentId } + sessions.filter { $0.id != currentId }
    }

    /// The `sid` claim of a password-login JWT, or nil for API tokens and anything undecodable.
    public static func currentSessionId(token: String?) -> String? {
        let parts = token?.split(separator: ".", omittingEmptySubsequences: false) ?? []
        guard parts.count > 1, !parts[1].isEmpty else { return nil }
        var base64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let sid = object["sid"] as? String, !sid.isEmpty else { return nil }
        return sid
    }

    /// A short device label from a User-Agent string ("Safari on iPhone").
    public static func describeDevice(_ userAgent: String) -> String {
        if userAgent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Unknown device" }
        let platforms: [(String, [String])] = [
            ("iPhone", ["iPhone"]), ("iPad", ["iPad"]), ("Android", ["Android"]),
            ("macOS", ["Mac OS X", "Macintosh"]), ("Windows", ["Windows"]), ("Linux", ["Linux"])
        ]
        let apps: [(String, [String])] = [
            ("Firefox", ["Firefox/"]), ("Edge", ["Edg/"]), ("Chrome", ["Chrome/"]),
            ("Safari", ["Safari/"]), ("Cria", ["AppleWebKit"])
        ]
        let platform = platforms.first { $0.1.contains { userAgent.contains($0) } }?.0
        let app = apps.first { $0.1.contains { userAgent.contains($0) } }?.0
        if let app, let platform { return "\(app) on \(platform)" }
        return app ?? platform ?? String(userAgent.prefix(40))
    }
}

public extension ApiClient {
    /// Nil when the server has no sessions route (older Vikunja), so the screen can say so.
    func sessions() async throws -> SessionListing? {
        var usedToken = ""
        // Sessions exist only on v2: pinned there, so a forced-v1 client still reaches them (older servers answer 404).
        let response = try await sendAuthorized(pin: .apiV2) { base, token in
            usedToken = token
            return try self.buildRequest(.get, url: base + "/user/sessions", query: ["per_page": "50"], body: nil, token: token)
        }
        if response.status == 404 { return nil }
        try response.requireSuccess()
        let list = ApiRoutes.unwrapEnvelope(response.data)?.items ?? response.data
        let rows = (try? JSONDecoder().decode([JSONValue]?.self, from: list)) ?? nil
        let parsed = (rows ?? []).compactMap(UserSession.init)
        return SessionListing(
            sessions: SessionRules.sorted(parsed), currentId: SessionRules.currentSessionId(token: usedToken)
        )
    }

    func revokeSession(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        try await perform(.delete, "/user/sessions/\(encoded)")
    }
}
