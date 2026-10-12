import GRDB
import XCTest
@testable import CriaKit

final class LabelEditingTests: XCTestCase {
    private func syncedLabel(_ store: CriaStore, id: Int = 4, title: String = "urgent") throws -> String {
        let json = #"{"id": \#(id), "title": "\#(title)", "description": "kept", "hex_color": "00ff00"}"#
        return try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, json), rawJSON: json)
    }

    private func drain(_ store: CriaStore, _ api: ApiClient) async {
        await OutboxDrainer(api: api, store: store, executors: ["label": LabelExecutor()]).drain()
    }

    func testUpdateWritesRowQueuesUpdateAndStripsHash() throws {
        let store = try makeStore()
        let label = try syncedLabel(store)
        let saved = try store.updateLabel(localId: label, title: "  Later  ", hexColor: "#3B82F6")
        XCTAssertEqual(saved.title, "Later")
        XCTAssertEqual(saved.hexColor, "3B82F6")
        XCTAssertEqual(saved.description, "kept")
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM labels WHERE dirty = 1"), 1)
        let entries = try outboxEntries(store, entity: "label")
        XCTAssertEqual(entries.map(\.operation), ["update"])
        let payload = try payloadObject(try XCTUnwrap(entries.first))
        XCTAssertEqual(payload["title"] as? String, "Later")
        XCTAssertEqual(payload["hex_color"] as? String, "3B82F6")
    }

    func testUpdateClearsColourAndRejectsEmptyTitle() throws {
        let store = try makeStore()
        let label = try syncedLabel(store)
        XCTAssertEqual(try store.updateLabel(localId: label, title: "urgent", hexColor: nil).hexColor, nil)
        XCTAssertThrowsError(try store.updateLabel(localId: label, title: "   ", hexColor: nil)) { error in
            XCTAssertEqual(error as? LabelEditError, .emptyTitle)
        }
        XCTAssertThrowsError(try store.updateLabel(localId: "missing", title: "x", hexColor: nil))
        XCTAssertEqual(try outboxEntries(store, entity: "label").count, 1)
    }

    func testUpdateAndDeleteAnnounceLabels() async throws {
        let store = try makeStore()
        let label = try syncedLabel(store)
        let stream = store.bus.subscribe()
        var iterator = stream.makeAsyncIterator()
        try store.updateLabel(localId: label, title: "Renamed", hexColor: nil)
        try store.deleteLabel(localId: label)
        var kinds: [ChangeKind] = []
        for _ in 0..<6 { if let kind = await iterator.next() { kinds.append(kind) } }
        XCTAssertEqual(kinds, [.labels, .tasks, .outbox, .labels, .tasks, .outbox])
    }

    func testDeleteHidesLabelUnlinksTasksAndQueuesOnlyTheLabelDelete() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Tagged", projectLocalId: project))
        let label = try syncedLabel(store)
        try store.toggleTaskLabel(taskLocalId: task.localId, labelLocalId: label)
        XCTAssertEqual(try store.taskCount(forLabel: label), 1)

        try store.deleteLabel(localId: label)
        XCTAssertTrue(try store.labels().isEmpty)
        XCTAssertTrue(try store.labels(forTask: task.localId).isEmpty)
        XCTAssertEqual(try store.taskCount(forLabel: label), 0)
        XCTAssertEqual(try store.openTaskCountsByLabel()[label], nil)
        XCTAssertEqual(try outboxEntries(store, entity: "label").map(\.operation), ["delete"])
        XCTAssertEqual(try outboxEntries(store, entity: "task_label").map(\.operation), ["create"], "no per-task removal")

        try store.deleteLabel(localId: label)
        XCTAssertEqual(try outboxEntries(store, entity: "label").count, 1, "a second delete queues nothing")
    }

    func testPullDoesNotResurrectAPendingDelete() throws {
        let store = try makeStore()
        let label = try syncedLabel(store)
        try store.deleteLabel(localId: label)
        _ = try syncedLabel(store, title: "server copy")
        XCTAssertTrue(try store.labels().isEmpty)
    }

    func testPushSendsRawHexThenDeletesOnServer() async throws {
        let store = try makeStore()
        let server = StubServer()
        let api = server.api()
        let label = try syncedLabel(store)
        server.json("POST /labels/4", #"{"id": 4, "title": "Later", "hex_color": "3b82f6", "updated": "2026-10-12T10:00:00Z"}"#)
        try store.updateLabel(localId: label, title: "Later", hexColor: "#3b82f6")
        await drain(store, api)
        let post = try XCTUnwrap(server.requests.last { $0.httpMethod == "POST" })
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(post.httpBody)) as? [String: Any])
        XCTAssertEqual(body["title"] as? String, "Later")
        XCTAssertEqual(body["hex_color"] as? String, "3b82f6")
        XCTAssertEqual(body["description"] as? String, "kept")
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM labels WHERE dirty = 1"), 0)

        server.json("DELETE /labels/4", #"{"message": "ok"}"#)
        try store.deleteLabel(localId: label)
        await drain(store, api)
        XCTAssertTrue(server.requests.contains { $0.httpMethod == "DELETE" && $0.url?.path.hasSuffix("/labels/4") == true })
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM labels"), 0)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM outbox"), 0)
    }
}
