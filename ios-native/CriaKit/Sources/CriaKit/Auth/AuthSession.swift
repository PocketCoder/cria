import Foundation

public enum AuthStatus: Equatable, Sendable {
    case unknown
    case unauthenticated
    case authenticated(Credentials)
}

/// Owns the signed-in session: credentials, token refresh and the sign-out policy.
/// Ported from `src/auth/store.ts` and the refresh logic in `src/api/client.ts`.
public actor AuthSession: SessionProviding {
    /// A genuinely revoked token keeps 401ing (the 60s sync alone hits several endpoints), but a single
    /// stray 401 is transient, so only this many in a row with no success between sign the user out.
    static let maxConsecutiveAuthFailures = 3

    public private(set) var status: AuthStatus = .unknown

    private let store: CredentialStore
    private let core: HTTPCore
    private let onSignOut: @Sendable () async -> Void
    private var consecutiveAuthFailures = 0
    private var refreshTask: Task<String?, Never>?

    /// `onSignOut` clears per-user state (cached user row, background cache) once credentials are gone.
    public init(store: CredentialStore = CredentialStore(), core: HTTPCore = HTTPCore(),
                onSignOut: @escaping @Sendable () async -> Void = {}) {
        self.store = store
        self.core = core
        self.onSignOut = onSignOut
    }

    public func hydrate() {
        if let credentials = store.load() {
            status = .authenticated(credentials)
        } else {
            status = .unauthenticated
        }
    }

    /// Persists first so a Keychain failure leaves the app signed out instead of half signed in.
    public func signIn(_ credentials: Credentials) throws {
        try store.save(credentials)
        consecutiveAuthFailures = 0
        status = .authenticated(credentials)
    }

    /// Swaps in a refreshed JWT (and rotated refresh token). No-op when signed out.
    public func updateSession(token: String, refreshToken: String?) {
        guard case .authenticated(var credentials) = status else { return }
        credentials.token = token
        credentials.refreshToken = refreshToken ?? credentials.refreshToken
        // In-memory state wins even if the Keychain is briefly unavailable; the next success persists it.
        try? store.save(credentials)
        status = .authenticated(credentials)
    }

    public func signOut() async {
        store.clear()
        consecutiveAuthFailures = 0
        status = .unauthenticated
        await onSignOut()
    }

    // MARK: SessionProviding

    public func snapshot() -> (serverURL: String, token: String)? {
        guard case .authenticated(let credentials) = status else { return nil }
        return (credentials.serverURL, credentials.token)
    }

    public func canRefresh() -> Bool {
        guard case .authenticated(let credentials) = status else { return false }
        return credentials.authMethod == .password && credentials.refreshToken != nil
    }

    public func noteAuthorized() {
        consecutiveAuthFailures = 0
    }

    public func noteUnauthorized() async {
        // A stray 401 during the login handshake cannot trigger a sign-out.
        guard case .authenticated = status else { return }
        consecutiveAuthFailures += 1
        if consecutiveAuthFailures >= Self.maxConsecutiveAuthFailures {
            await signOut()
        }
    }

    public func refreshSession(ifTokenIs used: String) async -> String? {
        if let current = snapshot()?.token, current != used { return current }
        return await refreshSession()
    }

    /// Single-flight: concurrent callers (a sync hits several endpoints at once) share one request.
    /// A second refresh would reuse the already-rotated refresh token and kill the session.
    public func refreshSession() async -> String? {
        if let refreshTask { return await refreshTask.value }
        let task = Task { () -> String? in
            let token = await self.performRefresh()
            self.refreshTask = nil
            return token
        }
        refreshTask = task
        return await task.value
    }

    private func performRefresh() async -> String? {
        guard case .authenticated(let credentials) = status, credentials.authMethod == .password,
              let refreshToken = credentials.refreshToken else { return nil }
        let base = "\(normalizeBase(credentials.serverURL))/api/v1"
        guard let url = URL(string: "\(base)/user/token/refresh") else { return nil }
        do {
            // Don't leak the refresh token over plaintext (same rule as bearer tokens).
            try guardDestination(base)
            var request = URLRequest(url: url)
            request.httpMethod = HTTPMethod.post.rawValue
            request.setValue("\(refreshCookieName)=\(refreshToken)", forHTTPHeaderField: "Cookie")
            let response = try await core.fetchOnce(request)
            guard response.isSuccess,
                  let body = try? JSONDecoder().decode(RefreshBody.self, from: response.data),
                  let token = body.token, !token.isEmpty else { return nil }
            updateSession(token: token, refreshToken: response.refreshCookie ?? refreshToken)
            return token
        } catch {
            return nil
        }
    }

    private struct RefreshBody: Decodable {
        let token: String?
    }
}
