import Foundation

/// A Vikunja link share pasted into the login screen: a share URL (`{server}/share/{hash}/auth`) or the bare hash.
/// Ported from `parseShareInput` in `src/lib/shareInput.ts`, plus the server origin the link was copied from.
public struct ShareLinkInput: Equatable, Sendable {
    public let hash: String
    /// Everything before `/share/` when the input was a full http(s) URL, so the server field can be filled from it.
    public let serverURL: String?

    /// Nil when the input is neither a share URL nor a plain alphanumeric hash.
    public static func parse(_ input: String) -> ShareLinkInput? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let pattern = #"/share/([A-Za-z0-9]+)(?:/auth)?/?(?:[?#]|$)"#
        if let match = trimmed.range(of: pattern, options: .regularExpression) {
            let tail = trimmed[match].dropFirst("/share/".count)
            let hash = String(tail.prefix { $0.isASCII && ($0.isLetter || $0.isNumber) })
            return ShareLinkInput(hash: hash, serverURL: origin(String(trimmed[..<match.lowerBound])))
        }
        let isHash = trimmed.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
        guard isHash, !["http", "https"].contains(trimmed.lowercased()) else { return nil }
        return ShareLinkInput(hash: trimmed, serverURL: nil)
    }

    private static func origin(_ prefix: String) -> String? {
        guard let url = URL(string: prefix), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return nil }
        return normalizeBase(prefix)
    }
}

/// Vikunja's error codes for `POST /shares/{hash}/auth` (`pkg/models/error.go`).
public enum LinkShareError {
    /// 412: the share has a password and none was sent.
    public static let passwordRequiredCode = 13001
    /// 403: the password sent does not match.
    public static let passwordInvalidCode = 13002

    public static func needsPassword(_ error: Error) -> Bool {
        guard let code = (error as? ApiError)?.code else { return false }
        return code == passwordRequiredCode || code == passwordInvalidCode
    }
}

/// Whether the signed-in session is a link share, kept in the app's defaults so screens can hide what a share cannot
/// use (account settings, tokens, teams) without reaching into the auth session. The app sets it on every launch and
/// sign-in from the stored credentials, and clears it on sign-out.
public enum LinkShareSessionFlag {
    public static let key = "cria.linkShareSession"

    public static func isActive(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: key)
    }

    public static func set(_ active: Bool, defaults: UserDefaults = .standard) {
        defaults.set(active, forKey: key)
    }
}

private struct ShareAuthBody: Encodable, Sendable {
    let password: String
}

private struct ShareAuthResponse: Decodable {
    let token: String?
}

public extension LoginService {
    /// Exchanges a link-share hash (and password, when the share has one) for a JWT scoped to the shared project.
    /// Ported from `authLinkShare` in `src/api/shareAuth.ts`. There is no account behind the token, so the result
    /// carries a stand-in user, as `makeShareUser` does.
    func signInWithLinkShare(serverURL: String, hash: String, password: String? = nil) async throws -> SignInResult {
        let base = normalizeBase(serverURL)
        // The password, and the token that comes back, must not travel over plain HTTP.
        try guardDestination("\(base)/api/v1")
        let body = ShareAuthBody(password: password ?? "")
        let response = try await ApiClient(serverURL: base, core: core).send(.post, "/shares/\(hash)/auth", body: body)
        try response.requireSuccess()
        guard let token = (try? JSONDecoder().decode(ShareAuthResponse.self, from: response.data))?.token, !token.isEmpty else {
            throw ApiError(status: response.status, code: nil, message: "The server returned no token.", retryable: false)
        }
        let user = UserResponse(id: 0, username: "link-share-\(hash)", email: nil, name: "Shared project", settings: nil)
        return SignInResult(credentials: Credentials(serverURL: base, token: token, authMethod: .linkShare), user: user)
    }
}
