import XCTest
@testable import CriaKit

final class UserSessionsTests: XCTestCase {
    private func jwt(payload: String) -> String {
        let encoded = Data(payload.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "h.\(encoded).s"
    }

    func testSessionIdFromJwt() {
        XCTAssertEqual(SessionRules.currentSessionId(token: jwt(payload: #"{"sid":"abc-1"}"#)), "abc-1")
        XCTAssertNil(SessionRules.currentSessionId(token: jwt(payload: #"{"sid":""}"#)))
        XCTAssertNil(SessionRules.currentSessionId(token: "tk_apitoken"))
        XCTAssertNil(SessionRules.currentSessionId(token: nil))
    }

    func testDescribeDevice() {
        XCTAssertEqual(SessionRules.describeDevice(""), "Unknown device")
        XCTAssertEqual(SessionRules.describeDevice("Mozilla/5.0 (iPhone) AppleWebKit/605 Safari/604"), "Safari on iPhone")
        XCTAssertEqual(SessionRules.describeDevice("Mozilla/5.0 (Macintosh; Mac OS X) AppleWebKit/605"), "Cria on macOS")
        XCTAssertEqual(SessionRules.describeDevice("curl/8"), "curl/8")
    }

    func testListSortsByActivityAndDropsRowsWithoutId() async throws {
        let json = """
        [{"id": "a", "last_active": "2026-01-01T00:00:00Z"}, {"id": "b", "last_active": "2026-02-01T00:00:00Z"},
         {"id": "c", "last_active": "0001-01-01T00:00:00Z"}, {"device_info": "no id"}]
        """
        let token = jwt(payload: #"{"sid":"a"}"#)
        let transport = StubTransport { _, _ in (200, json, ["Content-Type": "application/json"]) }
        let api = ApiClient(session: FakeSession(token: token), core: HTTPCore(transport: transport))
        let fetched = try await api.sessions()
        let listing = try XCTUnwrap(fetched)
        XCTAssertEqual(listing.sessions.map(\.id), ["b", "a", "c"])
        XCTAssertEqual(listing.currentId, "a")
        XCTAssertEqual(SessionRules.currentFirst(listing.sessions, currentId: "a").map(\.id), ["a", "b", "c"])
        XCTAssertEqual(transport.requests.first?.url?.query, "per_page=50")
    }

    func testMissingRouteIsNil() async throws {
        let transport = StubTransport { _, _ in (404, "", [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let listing = try await api.sessions()
        XCTAssertNil(listing)
    }

    func testRevokeIsDelete() async throws {
        let transport = StubTransport { _, _ in (200, "{}", [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        try await api.revokeSession(id: "a b")
        XCTAssertEqual(transport.requests.first?.httpMethod, "DELETE")
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/v2/user/sessions/a b")
    }
}
