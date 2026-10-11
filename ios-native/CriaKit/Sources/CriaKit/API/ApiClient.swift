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

    /// Server origin without a trailing slash, or nil when signed out.
    public func serverBase() async -> String? {
        if let fixedBase { return fixedBase }
        guard let snapshot = await session?.snapshot() else { return nil }
        return normalizeBase(snapshot.serverURL)
    }

    /// Sends a request and returns the raw response. Non-2xx is returned, not thrown;
    /// use `ApiResponse.decoded()` or the typed helpers below to throw `ApiError`.
    public func send(_ method: HTTPMethod, _ path: String, query: [String: String] = [:],
                     body: (any Encodable & Sendable)? = nil) async throws -> ApiResponse {
        try await sendAuthorized { base, token in
            try self.buildRequest(method, url: base + path, query: query, body: body, token: token)
        }
    }

    /// Shared send path: auth, plaintext guard, refresh-and-retry-once. `build` gets the API base and token.
    func sendAuthorized(_ build: (_ base: String, _ token: String) throws -> URLRequest) async throws -> ApiResponse {
        let snapshot = await session?.snapshot()
        if session != nil && snapshot == nil { throw AuthRequiredError() }
        let base = "\(fixedBase ?? normalizeBase(snapshot?.serverURL ?? ""))/api/\(version.rawValue)"
        let token = snapshot?.token ?? fixedToken ?? ""
        if !token.isEmpty { try guardDestination(base) }

        let first = try await core.fetchOnce(try build(base, token))
        guard let session else { return first }
        if first.isSuccess {
            await session.noteAuthorized()
            return first
        }
        guard first.status == 401 else { return first }
        // Refresh only for authenticated password sessions, never for the refresh call itself.
        if await session.canRefresh(), let fresh = await freshToken(after: token, session: session) {
            let retry = try await core.fetchOnce(try build(base, fresh))
            if retry.isSuccess { await session.noteAuthorized() }
            if retry.status == 401 { await session.noteUnauthorized() }
            return retry
        }
        await session.noteUnauthorized()
        return first
    }

    /// A 401 can arrive after a concurrent request already refreshed. Then the stored token differs from the one
    /// this request used, so retry with it instead of rotating the refresh token a second time.
    private func freshToken(after used: String, session: any SessionProviding) async -> String? {
        if let current = await session.snapshot()?.token, current != used { return current }
        return await session.refreshSession()
    }

    /// Uploads one file as multipart form data (Vikunja's attachment endpoint reads the plural `files` field)
    /// and returns the raw JSON of the first created attachment.
    public func uploadAttachment(taskId: Int, fileName: String, mime: String, bytes: Data) async throws -> Data {
        let boundary = "cria-\(UUID().uuidString)"
        var form = Data()
        let safeName = fileName.replacingOccurrences(of: "\"", with: "_")
        form.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"\(safeName)\"\r\n".utf8))
        form.append(Data("Content-Type: \(mime)\r\n\r\n".utf8))
        form.append(bytes)
        form.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let response = try await sendAuthorized { base, token in
            var request = try self.buildRequest(.put, url: base + "/tasks/\(taskId)/attachments", query: [:], body: nil, token: token)
            request.httpBody = form
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            return request
        }
        try response.requireSuccess()
        // Vikunja reports a rejected file (too large, say) as a 200 with an `errors` entry: a permanent failure.
        let object = (try? JSONSerialization.jsonObject(with: response.data)) as? [String: Any]
        if let first = (object?["success"] as? [Any])?.first,
           let data = try? JSONSerialization.data(withJSONObject: first) {
            return data
        }
        let rejected = (object?["errors"] as? [[String: Any]])?.first
        throw ApiError(
            status: response.status, code: rejected?["code"] as? Int,
            message: "upload rejected: \(rejected?["message"] as? String ?? "no attachment in the response")", retryable: false
        )
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

    /// JSON merge-patch (RFC 7386), as Vikunja v2 takes for partial updates. Non-2xx is returned, not thrown.
    public func mergePatch(_ path: String, body: JSONBody) async throws -> ApiResponse {
        try await sendAuthorized { base, token in
            var request = try self.buildRequest(.patch, url: base + path, query: [:], body: body, token: token)
            request.setValue("application/merge-patch+json", forHTTPHeaderField: "Content-Type")
            return request
        }
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
