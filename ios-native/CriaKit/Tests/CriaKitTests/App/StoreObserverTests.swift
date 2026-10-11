import XCTest
@testable import CriaKit

final class StoreObserverTests: XCTestCase {
    func testEmitsCurrentValueThenUpdatesOnMatchingChange() async throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let stream = observeStore(store, kinds: [.tasks]) { try $0.tasks(matching: TaskQuery()).map(\.title) }
        var iterator = stream.makeAsyncIterator()

        let initial = await iterator.next()
        XCTAssertEqual(initial, [])

        _ = try store.createTask(TaskInput(title: "Buy milk", projectLocalId: project))
        let updated = await iterator.next()
        XCTAssertEqual(updated, ["Buy milk"])
    }

    func testIgnoresUnrelatedChanges() async throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let stream = observeStore(store, kinds: [.labels]) { try $0.tasks(matching: TaskQuery()).count }
        var iterator = stream.makeAsyncIterator()
        _ = await iterator.next()

        _ = try store.createTask(TaskInput(title: "ignored", projectLocalId: project))
        store.bus.notify(.labels)
        let next = await iterator.next()
        XCTAssertEqual(next, 1)
    }

    func testOpensOnDiskDatabaseAndKeepsRows() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cria-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("cria.sqlite")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let first = CriaStore(database: try CriaDatabase.open(at: url))
        let project = try seedProject(first)
        _ = try first.createTask(TaskInput(title: "persisted", projectLocalId: project))

        let second = CriaStore(database: try CriaDatabase.open(at: url))
        XCTAssertEqual(try second.tasks(matching: TaskQuery()).map(\.title), ["persisted"])
    }
}
