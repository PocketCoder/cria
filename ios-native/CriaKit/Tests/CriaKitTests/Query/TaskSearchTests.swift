import XCTest
@testable import CriaKit

/// Offline FTS5 search. Tasks are written through the repository so the `tasks_fts` triggers
/// (003_fts.sql) are what keeps the index current.
final class TaskSearchTests: XCTestCase {
    private func search(_ store: CriaStore, _ text: String) throws -> [String] {
        try store.searchTasks(SearchQuery(text: text)).map(\.title)
    }

    private func syncTask(_ store: CriaStore, id: Int, title: String, description: String = "") throws {
        let json = #"{"id": \#(id), "project_id": 1, "title": "\#(title)", "description": "\#(description)"}"#
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
    }

    func testFindsSyncedTasksByTitlePrefixAndDescription() throws {
        let store = try makeStore()
        try seedProject(store)
        try syncTask(store, id: 1, title: "Buy milk", description: "semi skimmed from the corner shop")
        try syncTask(store, id: 2, title: "Book dentist")
        XCTAssertEqual(try search(store, "mil"), ["Buy milk"])
        XCTAssertEqual(try search(store, "SKIMMED"), ["Buy milk"])
        XCTAssertEqual(Set(try search(store, "b")), ["Buy milk", "Book dentist"])
    }

    func testMultipleWordsAreAndedAndPunctuationIsStripped() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        try store.createTask(TaskInput(title: "Buy milk", projectLocalId: project))
        try store.createTask(TaskInput(title: "Buy bread", projectLocalId: project))
        XCTAssertEqual(try search(store, "buy milk"), ["Buy milk"])
        XCTAssertEqual(try search(store, "milk!?"), ["Buy milk"])
        XCTAssertEqual(try search(store, "\"buy\" (bread)"), ["Buy bread"])
    }

    func testReservedWordsAreSearchedAsText() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        try store.createTask(TaskInput(title: "Salt and pepper", projectLocalId: project))
        try store.createTask(TaskInput(title: "Salt", projectLocalId: project))
        XCTAssertEqual(try search(store, "salt AND"), ["Salt and pepper"])
        XCTAssertEqual(CriaStore.ftsMatchExpression(for: "salt or near not"), "salt* AND \"or\" AND \"near\" AND \"not\"")
    }

    func testIndexFollowsUpdatesAndSoftDeletes() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Draft report", projectLocalId: project))
        XCTAssertEqual(try search(store, "draft"), ["Draft report"])

        try store.updateTask(localId: task.localId, patch: TaskPatch(title: "Final invoice"))
        XCTAssertEqual(try search(store, "draft"), [])
        XCTAssertEqual(try search(store, "invoice"), ["Final invoice"])

        try syncTask(store, id: 9, title: "Server renamed")
        XCTAssertEqual(try search(store, "renamed"), ["Server renamed"])
        try syncTask(store, id: 9, title: "Server changed")
        XCTAssertEqual(try search(store, "renamed"), [])
        XCTAssertEqual(try search(store, "changed"), ["Server changed"])

        try store.deleteTask(localId: task.localId)
        XCTAssertEqual(try search(store, "invoice"), [])
    }

    func testStructuredFiltersNarrowResults() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        try store.createTask(TaskInput(title: "Meeting prep", projectLocalId: project, dueDate: "2026-06-09T00:00:00Z", priority: 3))
        try store.createTask(TaskInput(title: "Meeting notes", projectLocalId: project, dueDate: "2026-06-20T00:00:00Z", priority: 1))
        try store.createTask(TaskInput(title: "Dentist", projectLocalId: project, dueDate: "2026-06-09T00:00:00Z", priority: 3))

        let now = try XCTUnwrap(Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 9, hour: 12)))
        let prioritised = parseSearchQuery("meeting !3", now: now)
        XCTAssertEqual(try store.searchTasks(prioritised).map(\.title), ["Meeting prep"])

        let range = SearchQuery(text: "meeting", dueDateStart: "2026-06-15T00:00:00.000Z", dueDateEnd: "2026-06-30T23:59:59.999Z")
        XCTAssertEqual(try store.searchTasks(range).map(\.title), ["Meeting notes"])

        let filtersOnly = SearchQuery(text: "", priority: 3)
        XCTAssertEqual(Set(try store.searchTasks(filtersOnly).map(\.title)), ["Meeting prep", "Dentist"])
    }

    func testLabelFilterAndProjectVisibility() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let tagged = try store.createTask(TaskInput(title: "Tagged chore", projectLocalId: project))
        try store.createTask(TaskInput(title: "Plain chore", projectLocalId: project))
        let json = #"{"id": 4, "title": "home"}"#
        let label = try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, json), rawJSON: json)
        try store.toggleTaskLabel(taskLocalId: tagged.localId, labelLocalId: label)

        let query = parseSearchQuery("chore #home")
        XCTAssertEqual(query.labelTitle, "home")
        XCTAssertEqual(try store.searchTasks(query).map(\.title), ["Tagged chore"])
        XCTAssertEqual(try search(store, "chore").count, 2)

        try store.toggleTaskLabel(taskLocalId: tagged.localId, labelLocalId: label)
        XCTAssertEqual(try store.searchTasks(query).map(\.title), [])
    }
}
