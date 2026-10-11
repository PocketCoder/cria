import XCTest
@testable import CriaKit

final class PaginationTests: XCTestCase {
    func testFetchesAllPagesInOrder() async throws {
        let transport = StubTransport { request, _ in
            let page = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "page" }?.value ?? "1"
            return (200, #"[{"id": \#(page)}]"#, ["x-pagination-total-pages": "3"])
        }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let items = try await api.fetchAllPages("/projects")
        XCTAssertEqual(items.count, 3)
        let ids = try items.map { try JSONDecoder().decode(ProjectResponse.self, from: $0).id }
        XCTAssertEqual(ids, [1, 2, 3])
        let first = try XCTUnwrap(transport.requests.first?.url?.query)
        XCTAssertTrue(first.contains("per_page=50"))
    }

    func testSinglePageWhenHeaderMissing() async throws {
        let transport = StubTransport { _, _ in (200, #"[{"id": 1}, {"id": 2}]"#, [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let items = try await api.fetchAllPages("/labels")
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testNullBodyIsEmpty() async throws {
        let transport = StubTransport { _, _ in (200, "null", [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        let items = try await api.fetchAllPages("/labels")
        XCTAssertTrue(items.isEmpty)
    }

    func testPageErrorThrows() async throws {
        let transport = StubTransport { _, _ in (500, "boom", [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        do {
            _ = try await api.fetchAllPages("/labels")
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 500)
        }
    }

    func testCookieParsing() {
        XCTAssertEqual(readRefreshCookie(setCookie: "vikunja_refresh_token=abc%2B1; Path=/; HttpOnly"), "abc+1")
        XCTAssertEqual(readRefreshCookie(setCookie: "other=1; Path=/, vikunja_refresh_token=zzz; Path=/"), "zzz")
        XCTAssertNil(readRefreshCookie(setCookie: "other=1"))
        XCTAssertNil(readRefreshCookie(setCookie: nil))
    }
}
