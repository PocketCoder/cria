import Foundation
@testable import CriaKit

/// Scripted transport: records every request and answers from a handler.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest, Int) async throws -> (Int, String, [String: String])

    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    private let handler: Handler

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    var requests: [URLRequest] { lock.withLock { recorded } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let index = lock.withLock {
            recorded.append(request)
            return recorded.count
        }
        let (status, body, headers) = try await handler(request, index)
        let url = request.url ?? URL(string: "https://invalid.test")!
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        return (Data(body.utf8), response)
    }
}

/// Fixed session for client tests. Records the signals the client sends back.
actor FakeSession: SessionProviding {
    var token: String
    let serverURL: String
    let refreshable: Bool
    let refreshedToken: String?
    private(set) var refreshCalls = 0
    private(set) var unauthorizedCount = 0
    private(set) var authorizedCount = 0

    init(serverURL: String = "https://vk.example", token: String = "old", refreshable: Bool = false, refreshedToken: String? = nil) {
        self.serverURL = serverURL
        self.token = token
        self.refreshable = refreshable
        self.refreshedToken = refreshedToken
    }

    func snapshot() -> (serverURL: String, token: String)? { (serverURL, token) }
    func canRefresh() -> Bool { refreshable }
    func refreshSession() -> String? {
        refreshCalls += 1
        if let refreshedToken { token = refreshedToken }
        return refreshedToken
    }
    func noteAuthorized() { authorizedCount += 1 }
    func noteUnauthorized() { unauthorizedCount += 1 }
}

func header(_ request: URLRequest, _ name: String) -> String? {
    request.value(forHTTPHeaderField: name)
}
