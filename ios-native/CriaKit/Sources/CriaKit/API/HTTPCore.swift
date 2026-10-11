import Foundation

/// One HTTP round trip. Tests inject a stub; the app uses `URLSessionTransport`.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    /// Pass a session whose configuration carries a `URLProtocol` stub in tests.
    public init(session: URLSession = URLSessionTransport.makeSession()) {
        self.session = session
    }

    public static func makeSession(protocolClasses: [AnyClass]? = nil) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = CircuitBreaker.requestTimeout
        if let protocolClasses { config.protocolClasses = protocolClasses }
        return URLSession(configuration: config)
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw NetworkError("Non-HTTP response") }
        return (data, http)
    }
}

public struct ApiResponse: Sendable {
    public let status: Int
    public let data: Data
    let refreshCookie: String?
    /// `x-pagination-total-pages` header; 1 when absent.
    public let totalPages: Int
    /// `Content-Type` header, if any.
    public let contentType: String?

    public var isSuccess: Bool { (200..<300).contains(status) }

    /// Decodes the body, or throws the `ApiError` for a non-2xx status.
    public func decoded<T: Decodable>(_ type: T.Type = T.self) throws -> T {
        try requireSuccess()
        return try JSONDecoder().decode(T.self, from: data)
    }

    public func requireSuccess() throws {
        if !isSuccess { throw buildApiError(status: status, body: data) }
    }
}

/// Vikunja's refresh-token cookie name (`pkg/modules/auth/auth.go`).
let refreshCookieName = "vikunja_refresh_token"

/// Pulls the refresh token out of one or more `Set-Cookie` values. URLSession joins repeated
/// headers with ", ", so the match is anchored on the cookie name rather than splitting.
public func readRefreshCookie(setCookie: String?) -> String? {
    guard let setCookie else { return nil }
    let pattern = "(?:^|[;,]\\s*)\(refreshCookieName)=([^;,]+)"
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: setCookie, range: NSRange(setCookie.startIndex..., in: setCookie)),
          let range = Range(match.range(at: 1), in: setCookie) else { return nil }
    return String(setCookie[range]).removingPercentEncoding
}

/// Refuses to send a token to a non-https, non-loopback origin. Ported from `guardTokenDestination`.
public func guardDestination(_ baseURL: String) throws {
    guard let url = URL(string: baseURL), let scheme = url.scheme, let host = url.host else {
        throw InsecureDestinationError(message: "Refusing to send credentials to an unparseable URL: \(baseURL)")
    }
    if scheme != "https", !["localhost", "127.0.0.1", "::1"].contains(host) {
        throw InsecureDestinationError(
            message: "Refusing to send credentials to \(scheme)://\(host): use https:// or a loopback address")
    }
}

public func normalizeBase(_ url: String) -> String {
    var trimmed = url.trimmingCharacters(in: .whitespaces)
    while trimmed.hasSuffix("/") { trimmed.removeLast() }
    return trimmed
}

public enum HTTPMethod: String, Sendable {
    case get = "GET", put = "PUT", post = "POST", delete = "DELETE", patch = "PATCH"
}

/// Raw single-shot network call: circuit breaker, timeout and error mapping. No auth logic, so the
/// refresh call can use it without recursing. Ported from `fetchOnce` in `src/api/client.ts`.
public final class HTTPCore: Sendable {
    let transport: any HTTPTransport
    public let breaker: CircuitBreaker

    public init(transport: any HTTPTransport = URLSessionTransport(), breaker: CircuitBreaker = CircuitBreaker()) {
        self.transport = transport
        self.breaker = breaker
    }

    public func fetchOnce(_ request: URLRequest) async throws -> ApiResponse {
        guard breaker.canAttempt() else {
            throw NetworkError("Server unavailable, backing off for \(Int(breaker.cooldownRemaining().rounded(.up)))s")
        }
        var request = request
        request.timeoutInterval = CircuitBreaker.requestTimeout
        request.httpShouldHandleCookies = false
        do {
            let (data, http) = try await transport.send(request)
            // A 5xx means the server is unhealthy; 2xx and 4xx mean it is responding.
            if http.statusCode >= 500 { breaker.recordFailure() } else { breaker.recordSuccess() }
            let setCookie = http.value(forHTTPHeaderField: "Set-Cookie")
            let pages = http.value(forHTTPHeaderField: "x-pagination-total-pages").flatMap { Int($0) } ?? 1
            return ApiResponse(status: http.statusCode, data: data,
                               refreshCookie: readRefreshCookie(setCookie: setCookie), totalPages: pages,
                               contentType: http.value(forHTTPHeaderField: "Content-Type"))
        } catch let error as NetworkError {
            breaker.recordFailure()
            throw error
        } catch is CancellationError {
            // The caller went away (a view disappeared); that says nothing about the server's health.
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            breaker.recordFailure()
            throw NetworkError(error.localizedDescription)
        }
    }
}
