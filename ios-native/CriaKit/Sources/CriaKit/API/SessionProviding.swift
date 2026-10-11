import Foundation

/// What the API client needs from the auth layer. `AuthSession` (S-22) is the production conformer.
public protocol SessionProviding: Sendable {
    /// Server origin and bearer token for the current session, or nil when signed out.
    func snapshot() async -> (serverURL: String, token: String)?
    /// True for password sessions with a refresh token (API-token logins never expire).
    func canRefresh() async -> Bool
    /// Exchanges the refresh token for a new JWT. Concurrent callers share one request.
    func refreshSession() async -> String?
    /// Refreshes unless the stored token already differs from `used` (a concurrent request refreshed first), in
    /// which case it returns the stored token. The check and the refresh must be one step, or two late 401s
    /// can both refresh and the second reuses a rotated refresh token.
    func refreshSession(ifTokenIs used: String) async -> String?
    /// Any 2xx proves the token still works, so the stray-401 streak resets.
    func noteAuthorized() async
    /// A 401 that survived the refresh attempt. Enough consecutive ones sign the user out.
    func noteUnauthorized() async
}

public extension SessionProviding {
    /// Non-atomic fallback for simple sessions. `AuthSession` overrides it with an atomic version.
    func refreshSession(ifTokenIs used: String) async -> String? {
        if let current = await snapshot()?.token, current != used { return current }
        return await refreshSession()
    }
}
