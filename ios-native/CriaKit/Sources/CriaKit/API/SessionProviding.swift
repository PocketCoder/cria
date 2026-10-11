import Foundation

/// What the API client needs from the auth layer. `AuthSession` (S-22) is the production conformer.
public protocol SessionProviding: Sendable {
    /// Server origin and bearer token for the current session, or nil when signed out.
    func snapshot() async -> (serverURL: String, token: String)?
    /// True for password sessions with a refresh token (API-token logins never expire).
    func canRefresh() async -> Bool
    /// Exchanges the refresh token for a new JWT. Concurrent callers share one request.
    func refreshSession() async -> String?
    /// Any 2xx proves the token still works, so the stray-401 streak resets.
    func noteAuthorized() async
    /// A 401 that survived the refresh attempt. Enough consecutive ones sign the user out.
    func noteUnauthorized() async
}
