import XCTest
@testable import CriaKit

final class TaskCoverTests: XCTestCase {
    func testPullStoresTheCoverAndANewPullReplacesIt() throws {
        let store = try makeStore()
        _ = try seedProject(store)
        let json = #"{"id": 30, "project_id": 1, "title": "Card", "cover_image_attachment_id": 7}"#
        let id = try XCTUnwrap(try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).first { $0.localId == id }?.coverAttachmentServerId, 7)
        let cleared = #"{"id": 30, "project_id": 1, "title": "Card", "cover_image_attachment_id": 0}"#
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, cleared), rawJSON: cleared)
        XCTAssertNil(try store.tasks(matching: TaskQuery()).first { $0.localId == id }?.coverAttachmentServerId)
    }

    func testSettingACoverIsADirtyUpdateAndSurvivesAPull() throws {
        let store = try makeStore()
        _ = try seedProject(store)
        let json = #"{"id": 31, "project_id": 1, "title": "Card"}"#
        let id = try XCTUnwrap(try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        var patch = TaskPatch()
        patch.coverImageAttachmentId = 9
        let record = try store.updateTask(localId: id, patch: patch)
        XCTAssertEqual(record.coverAttachmentServerId, 9)
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).first { $0.localId == id }?.coverAttachmentServerId, 9)
        patch.coverImageAttachmentId = 0
        XCTAssertNil(try store.updateTask(localId: id, patch: patch).coverAttachmentServerId)
    }

    func testPushBodyUsesTheStoredChoiceThenTheSnapshot() {
        XCTAssertEqual(TaskExecutor.coverToSend(stored: 9, lastSynced: nil), 9)
        XCTAssertEqual(TaskExecutor.coverToSend(stored: 0, lastSynced: #"{"cover_image_attachment_id": 4}"#), 0)
        XCTAssertEqual(TaskExecutor.coverToSend(stored: nil, lastSynced: #"{"cover_image_attachment_id": 4}"#), 4)
        XCTAssertNil(TaskExecutor.coverToSend(stored: nil, lastSynced: nil))
    }
}
