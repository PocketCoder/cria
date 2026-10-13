import GRDB
import XCTest
@testable import CriaKit

final class PullTests: XCTestCase {
    private func makePuller() throws -> (Puller, CriaStore, StubServer) {
        let store = try makeStore()
        let server = StubServer()
        return (Puller(api: server.api(), store: store), store, server)
    }

    func testPullProjectsPopulatesDBSilently() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /projects", """
            [{"id": 1, "title": "A"}, {"id": 2, "title": "B", "is_favorite": true, "hex_color": "ff0000"}]
            """)
        try await assertNoBusEvents(store) {
            let count = try await puller.pullProjects()
            XCTAssertEqual(count, 2)
        }
        XCTAssertEqual(try store.projects().map(\.title), ["A", "B"])
        XCTAssertNotNil(try store.syncStamp(.projects))
    }

    func testPullProjectsSkipsInvalidAndFavoritesPseudoProject() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /projects", """
            [{"id": -1, "title": "Favorites"}, {"id": -5, "title": "Filter"}, {"id": 2}, {"id": 3, "title": "Real"}]
            """)
        let count = try await puller.pullProjects()
        XCTAssertEqual(count, 2)
        let ids = try fetchInts(store, "SELECT server_id FROM projects ORDER BY server_id")
        XCTAssertEqual(ids, [-5, 3])
    }

    func testPullProjectsRelinksParentOnSecondPass() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /projects", """
            [{"id": 2, "title": "Child", "parent_project_id": 1}, {"id": 1, "title": "Parent"}]
            """)
        try await puller.pullProjects()
        let parent = try fetchStrings(store, """
            SELECT p2.title FROM projects p JOIN projects p2 ON p2.local_id = p.parent_local_id WHERE p.title = 'Child'
            """).first
        XCTAssertEqual(parent, "Parent")
    }

    func testPullProjectsPaginatesAndThrowsOnHTTPError() async throws {
        let (puller, _, server) = try makePuller()
        server.route(
            "GET /projects",
            .init(body: #"[{"id": 1, "title": "P1"}]"#, headers: ["x-pagination-total-pages": "2"]),
            .init(body: #"[{"id": 2, "title": "P2"}]"#, headers: ["x-pagination-total-pages": "2"])
        )
        let count = try await puller.pullProjects()
        XCTAssertEqual(count, 2)

        let (failing, _, broken) = try makePuller()
        broken.json("GET /projects", "boom", status: 500)
        do {
            try await failing.pullProjects()
            XCTFail("expected throw")
        } catch let error as ApiError {
            XCTAssertEqual(error.status, 500)
        }
    }

    func testPullLabelsIsIdempotent() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /labels", #"[{"id": 7, "title": "Home", "hex_color": "00ff00"}]"#)
        try await puller.pullLabels()
        try await puller.pullLabels()
        XCTAssertEqual(try store.labels().map(\.title), ["Home"])
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM labels"), 1)
    }
}
