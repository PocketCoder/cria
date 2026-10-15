import Foundation

public enum ApiVersion: String, Sendable {
    case apiV1 = "v1"
    case apiV2 = "v2"

    /// `/api/v1` or `/api/v2`, the only place the prefix is spelled out.
    public var basePath: String { "/api/\(rawValue)" }

    static let allVersions: [ApiVersion] = [.apiV1, .apiV2]
}

/// Which API generation to talk to. One rule shared with the TypeScript client (docs/V2-MIGRATION.md): v2 from
/// Vikunja 2.7.0, v1 for anything older or unparseable, and a persisted "Force API v1" switch that overrides it.
public enum ApiVersionPolicy {
    public static let minimumV2: (major: Int, minor: Int, patch: Int) = (2, 7, 0)
    public static let forceV1Key = "cria.forceApiV1"

    public static func forceV1(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: forceV1Key)
    }

    public static func setForceV1(_ enabled: Bool, defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: forceV1Key)
    }

    /// The leading `vMAJOR.MINOR.PATCH` of `/info`'s `version` (`v2.7.0-16-g58f7cf47`), or nil.
    public static func parse(_ version: String?) -> (major: Int, minor: Int, patch: Int)? {
        guard let version,
              let regex = RegexCache.regex(#"^\s*v?(\d+)\.(\d+)\.(\d+)"#),
              let match = regex.firstMatch(in: version, range: NSRange(version.startIndex..., in: version)) else { return nil }
        let parts = (1...3).compactMap { index -> Int? in
            Range(match.range(at: index), in: version).flatMap { Int(version[$0]) }
        }
        guard parts.count == 3 else { return nil }
        return (parts[0], parts[1], parts[2])
    }

    public static func resolve(infoVersion: String?, forceV1: Bool) -> ApiVersion {
        if forceV1 { return .apiV1 }
        guard let parsed = parse(infoVersion) else { return .apiV1 }
        let minimum = minimumV2
        return (parsed.major, parsed.minor, parsed.patch) >= (minimum.major, minimum.minor, minimum.patch) ? .apiV2 : .apiV1
    }
}

/// Decides the API version per server URL from `GET /info` (same on both versions) and remembers it. A failed probe
/// answers v1 without caching, so the next request tries again.
public final class VersionResolver: @unchecked Sendable {
    public static let shared = VersionResolver()

    private let lock = NSLock()
    private var cache: [String: ApiVersion] = [:]
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func version(forServer server: String, core: HTTPCore) async -> ApiVersion {
        if ApiVersionPolicy.forceV1(defaults: defaults) { return .apiV1 }
        let key = normalizeBase(server)
        if let cached = lock.withLock({ cache[key] }) { return cached }
        guard let info = try? await ApiClient(serverURL: key, core: core).info() else { return .apiV1 }
        let resolved = ApiVersionPolicy.resolve(infoVersion: info.version, forceV1: false)
        lock.withLock { cache[key] = resolved }
        return resolved
    }

    /// Forget one server (sign-in, server change) so the next request probes it again.
    public func reprobe(server: String) {
        let key = normalizeBase(server)
        lock.withLock { cache[key] = nil }
    }
}

/// Helpers for addresses that carry either API prefix (image links, link-share URLs, the CalDAV origin).
public enum ApiPaths {
    /// `server/api/v1` or `server/api/v2` (optionally with a trailing slash) reduced to `server`.
    public static func stripPrefix(_ address: String) -> String {
        address.replacingOccurrences(of: #"/api/v[12]/?$"#, with: "", options: .regularExpression)
    }

    /// True when `address` has an `/api/v1/` or `/api/v2/` segment.
    public static func hasPrefix(_ address: String) -> Bool {
        address.range(of: #"/api/v[12]/"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The path after the first `/api/v1/` or `/api/v2/`, with a leading slash, or nil.
    public static func path(after address: String) -> String? {
        guard let range = address.range(of: #"/api/v[12]/"#, options: .regularExpression) else { return nil }
        return "/" + address[range.upperBound...]
    }

    /// True when `address` starts with `server` followed by an API prefix (either version).
    public static func isServerAPI(_ address: String, server: String) -> Bool {
        let lower = address.lowercased()
        return ApiVersion.allVersions.contains { lower.hasPrefix((server + $0.basePath + "/").lowercased()) }
    }
}
