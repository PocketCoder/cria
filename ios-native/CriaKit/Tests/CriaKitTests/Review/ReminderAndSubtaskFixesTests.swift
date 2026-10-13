import GRDB
import XCTest
@testable import CriaKit

/// Device feedback: a fixed-time reminder read back as "at" after a pull, and a subtask could exist without its link.
final class ReminderAndSubtaskFixesTests: XCTestCase {
    private func decodeReminders(_ json: String) throws -> [TaskReminderResponse] {
        try JSONDecoder().decode([TaskReminderResponse].self, from: Data(json.utf8))
    }

    func testAPulledFixedTimeReminderStaysAbsolute() throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 1)
        let reminders = try decodeReminders(#"[{"reminder":"2026-10-13T08:00:00Z","relative_period":0,"relative_to":""}]"#)
        try store.replaceRemindersFromServer(taskLocalId: task, reminders)
        let stored = try XCTUnwrap(try store.reminders(forTask: task).first)
        XCTAssertNil(stored.relativeTo)
        XCTAssertNil(stored.relativePeriod)

        try store.removeReminder(taskLocalId: task, stored)
        XCTAssertTrue(try store.reminders(forTask: task).isEmpty)
    }

    func testAnOlderEmptyAnchorRowReadsAsAbsoluteAndCanBeRemoved() throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 1)
        try store.database.writer.write { connection in
            try connection.execute(sql: """
                INSERT INTO task_reminders (task_local_id, reminder_at, relative_period, relative_to, notified)
                VALUES (?, '2026-10-13T08:00:00Z', 0, '', 0)
                """, arguments: [task])
        }
        let stored = try XCTUnwrap(try store.reminders(forTask: task).first)
        XCTAssertNil(stored.relativeTo)
        try store.removeReminder(taskLocalId: task, stored)
        XCTAssertTrue(try store.reminders(forTask: task).isEmpty)
    }

    func testASubtaskAndItsLinkAreSavedTogether() throws {
        let store = try makeStore()
        try seedProject(store)
        let parent = try seedSyncedTask(store, serverId: 1, title: "Trip")
        let child = try store.createSubtask(parentLocalId: parent, title: "Pack")
        XCTAssertEqual(try store.subtaskMap()[parent], [child.localId])
        XCTAssertEqual(try outboxRows(store).map { $0["op"] as String }, ["create", "add"])
    }
}
