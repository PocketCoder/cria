import XCTest
@testable import CriaKit

final class SearchResultsTests: XCTestCase {
    func testFindsTasksOfflineByPrefixAndStem() throws {
        let store = try makeStore()
        let project = try seedProject(store, title: "Home")
        _ = try store.createTask(TaskInput(title: "Buying groceries", projectLocalId: project))
        _ = try store.createTask(TaskInput(title: "Call dentist", projectLocalId: project))

        let results = try store.search("groc")
        XCTAssertEqual(results.tasks.map(\.task.title), ["Buying groceries"])
        XCTAssertEqual(results.tasks.first?.projectTitle, "Home")
    }

    func testMatchesProjectsLabelsAndFiltersByTitle() throws {
        let store = try makeStore()
        try seedProject(store, serverId: 1, title: "Garden shed")
        try seedProject(store, serverId: 2, title: "Work")
        try store.createLabel(title: "gardening")
        try store.upsertSavedFilterFromServer(SavedFilterResponse(
            id: 3, title: "Garden jobs", filters: SavedFilterResponseFilters(filter: "done = false", filterIncludeNulls: false)
        ))

        let results = try store.search("Garden")
        XCTAssertEqual(results.projects.map(\.title), ["Garden shed"])
        XCTAssertEqual(results.labels.map(\.title), ["gardening"])
        XCTAssertEqual(results.filters.map(\.title), ["Garden jobs"])
    }

    func testBlankInputFindsNothing() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        _ = try store.createTask(TaskInput(title: "anything", projectLocalId: project))
        XCTAssertTrue(try store.search("   ").isEmpty)
        XCTAssertTrue(try store.search("").isEmpty)
    }

    func testPriorityTokenNarrowsTasksWithoutEntityMatches() throws {
        let store = try makeStore()
        let project = try seedProject(store, title: "Home")
        _ = try store.createTask(TaskInput(title: "urgent thing", projectLocalId: project, priority: 4))
        _ = try store.createTask(TaskInput(title: "calm thing", projectLocalId: project, priority: 1))

        let results = try store.search("thing !4")
        XCTAssertEqual(results.tasks.map(\.task.title), ["urgent thing"])
        XCTAssertEqual(results.projects, [])
    }

    func testNoMatchIsEmpty() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        _ = try store.createTask(TaskInput(title: "alpha", projectLocalId: project))
        XCTAssertTrue(try store.search("zzzz").isEmpty)
    }
}
