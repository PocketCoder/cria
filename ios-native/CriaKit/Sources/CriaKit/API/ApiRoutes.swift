import Foundation

/// The one place where v1 and v2 differ in shape. Callers keep writing the v1 call (`PUT` creates, `POST` updates,
/// `s` searches); on a v2 server `translate` rewrites verb, path and query. Verified against Vikunja's
/// `/api/v2/openapi-3.0.json` (see the v1/v2 section of AGENTS.md).
public enum ApiRoutes {
    struct Translated {
        var method: HTTPMethod
        var path: String
        var query: [String: String]
    }

    /// Routes with no v2 equivalent: they stay on `/api/v1` even on a v2 server.
    static let v1OnlyPrefixes = ["/user/settings/totp", "/user/settings/avatar/upload", "/migration/microsoft-todo"]

    /// Routes that exist only on v2.
    static let v2OnlyPrefixes = ["/user/sessions"]

    static func isV1Only(_ path: String) -> Bool {
        v1OnlyPrefixes.contains { path == $0 || path.hasPrefix($0 + "/") }
    }

    static func isV2Only(_ path: String) -> Bool {
        v2OnlyPrefixes.contains { path == $0 || path.hasPrefix($0 + "/") }
    }

    /// The version a path is pinned to, or nil to follow the resolved one.
    static func pin(for path: String) -> ApiVersion? {
        if isV1Only(path) { return .apiV1 }
        if isV2Only(path) { return .apiV2 }
        return nil
    }

    /// v1 `PUT` (create) routes that are `POST` on v2. `*` matches any one segment.
    private static let createRoutes: [[String]] = [
        ["projects"], ["labels"], ["filters"], ["teams"], ["tokens"], ["user", "settings", "token", "caldav"],
        ["projects", "*", "tasks"], ["projects", "*", "views"], ["projects", "*", "views", "*", "buckets"],
        ["projects", "*", "shares"], ["projects", "*", "users"], ["projects", "*", "teams"],
        ["projects", "*", "duplicate"], ["tasks", "*", "duplicate"],
        ["tasks", "*", "assignees"], ["tasks", "*", "labels"], ["tasks", "*", "comments"], ["tasks", "*", "relations"],
        ["tasks", "*", "attachments"], ["teams", "*", "members"], ["*", "*", "reactions"], ["subscriptions", "*", "*"]
    ]

    /// v1 `POST` (update) routes that are `PUT` on v2 (a full replace: callers send whole bodies).
    private static let updateRoutes: [[String]] = [
        ["projects", "*"], ["labels", "*"], ["tasks", "*"], ["filters", "*"], ["teams", "*"],
        ["projects", "*", "views", "*"], ["tasks", "*", "comments", "*"], ["projects", "*", "views", "*", "buckets", "*"],
        ["projects", "*", "users", "*"], ["projects", "*", "teams", "*"], ["notifications", "*"],
        ["tasks", "*", "position"], ["user", "settings", "email"], ["projects", "*", "backgrounds", "unsplash"],
        ["projects", "*", "views", "*", "buckets", "*", "tasks"]
    ]

    private static func matches(_ pattern: [String], _ segments: [String]) -> Bool {
        pattern.count == segments.count && zip(pattern, segments).allSatisfy { $0 == "*" || $0 == $1 }
    }

    static func translate(_ method: HTTPMethod, _ path: String, _ query: [String: String], for version: ApiVersion) -> Translated {
        var result = Translated(method: method, path: path, query: query)
        guard version == .apiV2 else { return result }
        let segments = path.split(separator: "/").map(String.init)
        if method == .put, createRoutes.contains(where: { matches($0, segments) }) {
            result.method = .post
        } else if method == .post, updateRoutes.contains(where: { matches($0, segments) }) {
            result.method = .put
        }
        if path == "/user/settings/avatar" {
            result.path = "/user/settings/avatar/provider"
            if method == .post { result.method = .put }
        }
        if method == .get, path == "/users" || path == "/backgrounds/unsplash/search" {
            if let search = result.query.removeValue(forKey: "s") { result.query["q"] = search }
            if let page = result.query.removeValue(forKey: "p") { result.query["page"] = page }
        }
        return result
    }

    /// v2 lists answer `{items, page, per_page, total, total_pages}`. Returns the bare array and page count, or nil
    /// when `data` is not an envelope (v1 bodies never carry both `items` and `total_pages`).
    static func unwrapEnvelope(_ data: Data) -> (items: Data, totalPages: Int)? {
        guard data.first == UInt8(ascii: "{"),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              object.keys.contains("items"), object.keys.contains("total_pages") || object.keys.contains("total") else { return nil }
        let items = (object["items"] as? [Any]) ?? []
        guard let bare = try? JSONSerialization.data(withJSONObject: items) else { return nil }
        return (bare, (object["total_pages"] as? Int) ?? 0)
    }
}
