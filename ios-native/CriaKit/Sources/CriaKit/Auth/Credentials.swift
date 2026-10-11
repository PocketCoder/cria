import Foundation

public enum AuthMethod: String, Codable, Sendable {
    case token, password, linkShare
}

/// The whole credential blob, stored as one JSON value in the Keychain. Mirrors `Credentials` in
/// `src/auth/storage.ts`; the JSON keys match so a blob is readable by either client.
public struct Credentials: Codable, Equatable, Sendable {
    public var serverURL: String
    public var token: String
    public var authMethod: AuthMethod
    /// Cookie-based refresh token, password sessions only.
    public var refreshToken: String?

    public init(serverURL: String, token: String, authMethod: AuthMethod, refreshToken: String? = nil) {
        self.serverURL = serverURL
        self.token = token
        self.authMethod = authMethod
        self.refreshToken = refreshToken
    }

    enum CodingKeys: String, CodingKey {
        case serverURL = "serverUrl"
        case token, authMethod, refreshToken
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        serverURL = try container.decode(String.self, forKey: .serverURL)
        token = try container.decode(String.self, forKey: .token)
        // Unknown or missing methods normalise to `token`, as `normalizeAuthMethod` does.
        let raw = try container.decodeIfPresent(String.self, forKey: .authMethod)
        authMethod = raw.flatMap(AuthMethod.init(rawValue:)) ?? .token
        refreshToken = try container.decodeIfPresent(String.self, forKey: .refreshToken)
    }
}
