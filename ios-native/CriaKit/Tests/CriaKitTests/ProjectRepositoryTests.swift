import XCTest
@testable import CriaKit

final class ProjectRepositoryTests: XCTestCase {
    func testUpsertInsertsThenUpdatesSameRow() throws {
        let store = try makeStore()
        let first = try seedProject(store, title: "Inbox")
        let json = #"{"id": 1, "title": "Renamed", "is_favorite": true}"#
        let again = try store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json)

        XCTAssertEqual(again, first)
        let projects = try store.projects()
        XCTAssertEqual(projects.count, 1)
        XCTAssertEqual(projects.first?.title, "Renamed")
        XCTAssertEqual(projects.first?.isFavorite, true)
    }

    func testSyncUpsertQueuesNothing() throws {
        let store = try makeStore()
        try seedProject(store)
        XCTAssertEqual(try outboxRows(store).count, 0)
    }

    func testDirtyRowIsNotOverwrittenByServer() throws {
        let store = try makeStore()
        let localId = try seedProject(store, title: "Inbox")
        try store.setProjectFavorite(localId: localId, isFavorite: true)

        let json = #"{"id": 1, "title": "Server title", "is_favorite": false}"#
        try store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json)

        let project = try XCTUnwrap(try store.projects().first)
        XCTAssertEqual(project.isFavorite, true)
        XCTAssertEqual(project.title, "Inbox")
    }

    func testFavouriteQueuesOutboxUpdate() throws {
        let store = try makeStore()
        let localId = try seedProject(store)
        try store.setProjectFavorite(localId: localId, isFavorite: true)

        let rows = try outboxRows(store)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?["entity_type"] as String?, "project")
        XCTAssertEqual(rows.first?["op"] as String?, "update")
    }
}
