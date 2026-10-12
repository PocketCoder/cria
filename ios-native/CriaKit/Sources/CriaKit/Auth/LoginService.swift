import Foundation

public struct PasswordLoginResult: Equatable, Sendable {
    /// Short-lived access JWT.
    public let token: String
    /// Refresh token from the login cookie. Nil for older Vikunja versions that set none.
    public let refreshToken: String?
}

/// The outcome of a completed sign-in: the credentials to persist and the user row to cache.
public struct SignInResult: Equatable, Sendable {
    public let credentials: Credentials
    public let user: UserResponse
}

private struct LoginBody: Encodable, Sendable {
    let username: String
    let password: String
    let longToken: Bool
    let totpPasscode: String?

    enum CodingKeys: String, CodingKey {
        case username, password
        case longToken = "long_token"
        case totpPasscode = "totp_passcode"
    }
}

private struct LoginResponse: Decodable {
    let token: String?
}

/// Unauthenticated login calls. Ported from `src/api/login.ts` and `LoginScreen.tsx`.
public struct LoginService: Sendable {
    let core: HTTPCore

    public init(core: HTTPCore = HTTPCore()) {
        self.core = core
    }

    /// Light healthcheck of `/info` (no auth). Confirms the URL is a reachable Vikunja instance.
    public func probeServer(_ serverURL: String) async throws -> ServerInfo {
        try await ApiClient(serverURL: serverURL, core: core).info()
    }

    public func loginWithPassword(serverURL: String, username: String, password: String,
                                  longToken: Bool = true, totpPasscode: String? = nil) async throws -> PasswordLoginResult {
        let base = normalizeBase(serverURL)
        // Last line of defence before the password goes out, independent of the form's own validation.
        try guardDestination("\(base)/api/v1")
        let body = LoginBody(username: username, password: password, longToken: longToken, totpPasscode: totpPasscode)
        let response = try await ApiClient(serverURL: base, core: core).send(.post, "/login", body: body)
        try response.requireSuccess()
        guard let token = (try? JSONDecoder().decode(LoginResponse.self, from: response.data))?.token, !token.isEmpty else {
            throw ApiError(status: response.status, code: nil, message: "The server returned no token.", retryable: false)
        }
        return PasswordLoginResult(token: token, refreshToken: response.refreshCookie)
    }

    /// Validates a pasted API token by fetching the current user with it.
    public func signInWithToken(serverURL: String, token: String) async throws -> SignInResult {
        let base = normalizeBase(serverURL)
        let user = try await ApiClient(serverURL: base, token: token, core: core).currentUser()
        return SignInResult(credentials: Credentials(serverURL: base, token: token, authMethod: .token), user: user)
    }

    public func signInWithPassword(serverURL: String, username: String, password: String,
                                   totpPasscode: String? = nil) async throws -> SignInResult {
        let base = normalizeBase(serverURL)
        let login = try await loginWithPassword(serverURL: base, username: username, password: password,
                                                totpPasscode: totpPasscode)
        let user = try await ApiClient(serverURL: base, token: login.token, core: core).currentUser()
        let credentials = Credentials(serverURL: base, token: login.token, authMethod: .password, refreshToken: login.refreshToken)
        return SignInResult(credentials: credentials, user: user)
    }
}
