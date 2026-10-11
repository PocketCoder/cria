import Foundation

public enum ApiVersion: String, Sendable {
    case apiV1 = "v1"
    case apiV2 = "v2"
}

/// Authenticated Vikunja client. Ported from `src/api/client.ts`: bearer auth, a transparent
/// refresh-and-retry-once on 401 for password sessions, the circuit breaker and the plaintext guard.
public final class ApiClient: Sendable {
    let core: HTTPCore
    private let session: (any SessionProviding)?
    private let fixedBase: String?
    private let fixedToken: String?
    private let version: ApiVersion

    /// Session-bound client: server URL and token come from `session` on every request, so token
    /// rotation takes effect immediately.
    public init(session: any SessionProviding, core: HTTPCore = HTTPCore(), version: ApiVersion = .apiV1) {
        self.session = session
        self.core = core
        self.fixedBase = nil
        self.fixedToken = nil
        self.version = version
    }

    /// Client for a fixed server with an optional fixed token (login, `/info`, verifying a pasted token).
    /// No refresh logic: there is no session behind it.
    public init(serverURL: String, token: String? = nil, core: HTTPCore = HTTPCore(), version: ApiVersion = .apiV1) {
        self.session = nil
        self.core = core
        self.fixedBase = normalizeBase(serverURL)
        self.fixedToken = token
        self.version = version
    }

    /// Sends a request and returns the raw response. Non-2xx is returned, not thrown;
    /// use `ApiResponse.decoded()` or the typed helpers below to throw `ApiError`.
    public func send(_ method: HTTPMethod, _ path: String, query: [String: String] = [:],
                     body: (any Encodable & Sendable)? = nil) async throws -> ApiResponse {
        let snapshot = await session?.snapshot()
        if session != nil && snapshot == nil { throw AuthRequiredError() }
        let base = "\(fixedBase ?? normalizeBase(snapshot?.serverURL ?? ""))/api/\(version.rawValue)"
        let token = snapshot?.token ?? fixedToken ?? ""
        if !token.isEmpty { try guardDestination(base) }

        let request = try buildRequest(method, url: base + path, query: query, body: body, token: token)
        let first = try await core.fetchOnce(request)
        guard let session else { return first }
        if first.isSuccess {
            await session.noteAuthorized()
            return first
        }
        guard first.status == 401 else { return first }
        // Refresh only for authenticated password sessions, never for the refresh call itself.
        if await session.canRefresh(), let fresh = await session.refreshSession() {
            let retry = try await core.fetchOnce(
                try buildRequest(method, url: base + path, query: query, body: body, token: fresh))
            if retry.isSuccess { await session.noteAuthorized() }
            if retry.status == 401 { await session.noteUnauthorized() }
            return retry
        }
        await session.noteUnauthorized()
        return first
    }

    func buildRequest(_ method: HTTPMethod, url urlString: String, query: [String: String],
                      body: (any Encodable & Sendable)?, token: String) throws -> URLRequest {
        guard var components = URLComponents(string: urlString) else {
            throw NetworkError("Invalid URL: \(urlString)")
        }
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw NetworkError("Invalid URL: \(urlString)") }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    // MARK: Typed helpers (the `callApi` equivalent)

    public func get<T: Decodable>(_ path: String, query: [String: String] = [:], as type: T.Type = T.self) async throws -> T {
        try await send(.get, path, query: query).decoded(T.self)
    }

    public func put<T: Decodable>(_ path: String, body: (any Encodable & Sendable)? = nil, as type: T.Type = T.self) async throws -> T {
        try await send(.put, path, body: body).decoded(T.self)
    }

    public func post<T: Decodable>(_ path: String, body: (any Encodable & Sendable)? = nil, as type: T.Type = T.self) async throws -> T {
        try await send(.post, path, body: body).decoded(T.self)
    }

    /// For endpoints whose response body is ignored (DELETE, most POST acknowledgements).
    public func perform(_ method: HTTPMethod, _ path: String, body: (any Encodable & Sendable)? = nil) async throws {
        try await send(method, path, body: body).requireSuccess()
    }
}
