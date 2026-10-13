import XCTest
@testable import CriaKit

final class TaskListDataTests: XCTestCase {
    private func seedLabel(_ store: CriaStore, serverId: Int, title: String) throws -> String {
        let json = #"{"id": \#(serverId), "title": "\#(title)"}"#
        return try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, json), rawJSON: json)
    }

    func testProjectItemsCarryLabelsAndProjectTitle() throws {
        let store = try makeStore()
        let project = try seedProject(store, title: "Home")
        let task = try store.createTask(TaskInput(title: "Buy milk", projectLocalId: project))
        let label = try seedLabel(store, serverId: 1, title: "errands")
        try store.toggleTaskLabel(taskLocalId: task.localId, labelLocalId: label)

        let items = try store.taskItems(.project(project))
        XCTAssertEqual(items.map(\.task.title), ["Buy milk"])
        XCTAssertEqual(items.first?.labels.map(\.title), ["errands"])
        XCTAssertEqual(items.first?.projectTitle, "Home")
    }

    func testLabelSourceReturnsOnlyTaggedTasks() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let tagged = try store.createTask(TaskInput(title: "tagged", projectLocalId: project))
        _ = try store.createTask(TaskInput(title: "plain", projectLocalId: project))
        let label = try seedLabel(store, serverId: 2, title: "work")
        try store.toggleTaskLabel(taskLocalId: tagged.localId, labelLocalId: label)

        XCTAssertEqual(try store.taskItems(.label(label)).map(\.task.title), ["tagged"])
        try store.toggleTaskLabel(taskLocalId: tagged.localId, labelLocalId: label)
        XCTAssertEqual(try store.taskItems(.label(label)), [])
    }

    func testFavouritesAndHideDone() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let star = try store.createTask(TaskInput(title: "star", projectLocalId: project, isFavorite: true))
        _ = try store.createTask(TaskInput(title: "plain", projectLocalId: project))
        XCTAssertEqual(try store.taskItems(.favorites).map(\.task.title), ["star"])
        _ = try store.updateTask(localId: star.localId, patch: TaskPatch(done: true))
        XCTAssertEqual(try store.taskItems(.favorites, includeDone: false), [])
        XCTAssertEqual(try store.taskItems(.project(project), includeDone: false).map(\.task.title), ["plain"])
    }
}
