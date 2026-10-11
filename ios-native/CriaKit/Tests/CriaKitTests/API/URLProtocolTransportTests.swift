// swiftlint:disable large_tuple
import XCTest
@testable import CriaKit

/// Exercises the real `URLSessionTransport` through a `URLProtocol` stub.
class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> (Int, Data, [String: String]))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler, let url = request.url else { return }
        let (status, data, headers) = handler(request)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class URLProtocolTransportTests: XCTestCase {
    func testRoundTripThroughURLSession() async throws {
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/info")
            return (200, Data(#"{"version": "1.0"}"#.utf8), ["x-pagination-total-pages": "2"])
        }
        defer { StubURLProtocol.handler = nil }
        let transport = URLSessionTransport(session: URLSessionTransport.makeSession(protocolClasses: [StubURLProtocol.self]))
        let api = ApiClient(serverURL: "https://vk.example", core: HTTPCore(transport: transport))
        let info = try await api.info()
        XCTAssertEqual(info.version, "1.0")
    }

    func testNetworkFailureMapsToNetworkError() async throws {
        StubURLProtocol.handler = nil
        let transport = URLSessionTransport(session: URLSessionTransport.makeSession(protocolClasses: [FailingURLProtocol.self]))
        let core = HTTPCore(transport: transport)
        do {
            _ = try await core.fetchOnce(URLRequest(url: URL(string: "https://vk.example/api/v1/info")!))
            XCTFail("expected throw")
        } catch is NetworkError {}
    }
}

class FailingURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}
