import XCTest
@testable import CriaKit

final class SavedFilterRepositoryTests: XCTestCase {
    private func payload(_ id: Int, _ title: String, filter: String = "done = false") -> SavedFilterResponse {
        SavedFilterResponse(
            id: id,
            title: title,
            description: nil,
            filters: SavedFilterResponseFilters(filter: filter, filterIncludeNulls: false),
            updated: "2026-07-01T00:00:00Z"
        )
    }

    func testUpsertsFromServerPayloadAndListsOrderedByTitle() throws {
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(payload(2, "Zebra"))
        try store.upsertSavedFilterFromServer(payload(1, "Alpha", filter: "priority >= 3"))

        let filters = try store.savedFilters()
        XCTAssertEqual(filters.map(\.title), ["Alpha", "Zebra"])
        XCTAssertEqual(filters.first?.serverId, 1)
        XCTAssertEqual(filters.first?.filterQuery, "priority >= 3")
        XCTAssertEqual(filters.first?.filterIncludeNulls, false)
        XCTAssertEqual(filters.first?.updatedAt, "2026-07-01T00:00:00Z")
    }

    func testRepeatedUpsertOfTheSameServerIdUpdatesInPlace() throws {
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(payload(1, "Old title"))
        try store.upsertSavedFilterFromServer(payload(1, "New title", filter: "done = true"))

        let filters = try store.savedFilters()
        XCTAssertEqual(filters.count, 1)
        XCTAssertEqual(filters.first?.title, "New title")
        XCTAssertEqual(filters.first?.filterQuery, "done = true")
    }

    func testPayloadWithoutAnIdIsIgnored() throws {
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(SavedFilterResponse(id: nil, title: "No id"))
        XCTAssertEqual(try store.savedFilters().count, 0)
    }

    func testMissingFieldsFallBackToEmptyQueryAndTitle() throws {
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(SavedFilterResponse(id: 3, title: nil))
        let filter = try XCTUnwrap(try store.savedFilter(serverId: 3))
        XCTAssertEqual(filter.title, "")
        XCTAssertEqual(filter.filterQuery, "")
        XCTAssertFalse(filter.filterIncludeNulls)
        XCTAssertNil(filter.updatedAt)
    }

    func testDecodesTheServerShape() throws {
        let response = try decodeFixture(SavedFilterResponse.self, """
        {"id": 5, "title": "Mine", "description": "d", "filters": {"filter": "done = false", "filter_include_nulls": true},
         "updated": "2026-07-01T00:00:00Z"}
        """)
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(response)
        let filter = try XCTUnwrap(try store.savedFilter(serverId: 5))
        XCTAssertEqual(filter.description, "d")
        XCTAssertTrue(filter.filterIncludeNulls)
    }

    func testGetsAFilterByServerId() throws {
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(payload(7, "Mine"))
        XCTAssertEqual(try store.savedFilter(serverId: 7)?.title, "Mine")
        XCTAssertNil(try store.savedFilter(serverId: 999))
    }

    func testDeletesByServerId() throws {
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(payload(1, "A"))
        try store.upsertSavedFilterFromServer(payload(2, "B"))
        try store.deleteSavedFilter(serverId: 1)
        XCTAssertEqual(try store.savedFilters().map(\.serverId), [2])
    }

    func testPrunesRowsNotInTheKeepSet() throws {
        let store = try makeStore()
        for (index, title) in ["A", "B", "C"].enumerated() {
            try store.upsertSavedFilterFromServer(payload(index + 1, title))
        }
        try store.pruneSavedFilters(keeping: [1, 3])
        XCTAssertEqual(try store.savedFilters().map(\.serverId), [1, 3])
    }

    func testPruneWithAnEmptyKeepSetRemovesEverything() throws {
        let store = try makeStore()
        try store.upsertSavedFilterFromServer(payload(1, "A"))
        try store.pruneSavedFilters(keeping: [])
        XCTAssertEqual(try store.savedFilters().count, 0)
    }

    /// AGENTS.md: sync-path upserts must never notify (refetch loop). Only the user delete announces.
    func testSyncUpsertAndPruneAreSilentButUserDeleteAnnounces() async throws {
        let store = try makeStore()
        let stream = store.bus.subscribe()
        var iterator = stream.makeAsyncIterator()
        try store.upsertSavedFilterFromServer(payload(1, "A"))
        try store.pruneSavedFilters(keeping: [1])
        try store.deleteSavedFilter(serverId: 1)
        let first = await iterator.next()
        XCTAssertEqual(first, .savedFilters)
    }
}
