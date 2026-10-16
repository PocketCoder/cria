import XCTest
@testable import CriaKit

final class ProjectOrderTests: XCTestCase {
    func testReindexWritesEvenStepsAndQueuesUpdates() throws {
        let store = try makeStore()
        let first = try seedProject(store, serverId: 1, title: "Alpha")
        let second = try seedProject(store, serverId: 2, title: "Beta")
        let third = try seedProject(store, serverId: 3, title: "Gamma")

        try store.reorderProjects([third, first, second], moved: third)

        XCTAssertEqual(try store.projects().map(\.title), ["Gamma", "Alpha", "Beta"])
        XCTAssertEqual(try store.projects().map(\.position), [1024, 2048, 3072])
        XCTAssertEqual(try outboxRows(store).map { $0["op"] as String? }, ["update", "update", "update"])
    }

    func testMidpointMovesOnlyTheDraggedProject() throws {
        let store = try makeStore()
        let first = try seedProject(store, serverId: 1, title: "Alpha")
        let second = try seedProject(store, serverId: 2, title: "Beta")
        let third = try seedProject(store, serverId: 3, title: "Gamma")
        try store.reindexProjects([first, second, third])
        let before = try outboxRows(store).count

        try store.reorderProjects([first, third, second], moved: third)

        XCTAssertEqual(try store.projects().map(\.title), ["Alpha", "Gamma", "Beta"])
        XCTAssertEqual(try store.projects().first { $0.localId == third }?.position, 1536)
        XCTAssertEqual(try outboxRows(store).count, before + 1)
    }

    func testUnknownProjectThrows() throws {
        let store = try makeStore()
        XCTAssertThrowsError(try store.setProjectPosition(localId: "missing", position: 10))
    }
}
