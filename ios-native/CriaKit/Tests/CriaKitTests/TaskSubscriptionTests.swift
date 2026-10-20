import XCTest
@testable import CriaKit

final class TaskSubscriptionTests: XCTestCase {
    func testPullReadsSubscriptionAndLocalStampSticksUntilNextPull() throws {
        let store = try makeStore()
        try seedProject(store)
        let json = taskJSON(id: 21, projectId: 1, title: "Watch me").replacingOccurrences(of: "{", with: "{\"is_subscribed\": true, ")
        let localId = try XCTUnwrap(try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        XCTAssertEqual(try store.task(localId: localId)?.isSubscribed, true)

        try store.setTaskSubscribed(localId: localId, subscribed: false)
        XCTAssertEqual(try store.task(localId: localId)?.isSubscribed, false)

        // A server answer without the flag reads as unsubscribed.
        let plain = taskJSON(id: 21, projectId: 1, title: "Watch me")
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, plain), rawJSON: plain)
        XCTAssertEqual(try store.task(localId: localId)?.isSubscribed, false)
    }

    func testNewLocalTaskIsNotSubscribed() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Local", projectLocalId: project))
        XCTAssertFalse(task.isSubscribed)
    }
}
