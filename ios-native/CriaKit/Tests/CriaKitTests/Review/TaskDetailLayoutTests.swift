import GRDB
import XCTest
@testable import CriaKit

/// Subtask-driven progress, the task screen's section order and the date sheet's typed dates.
final class TaskDetailLayoutTests: XCTestCase {
    func testParentProgressFollowsItsSubtasksUnlessSetByHand() throws {
        let store = try makeStore()
        try seedProject(store)
        let parent = try seedSyncedTask(store, serverId: 1, title: "Trip")
        ProgressOverride.setManual(parent, false)
        let first = try store.createSubtask(parentLocalId: parent, title: "Book")
        _ = try store.createSubtask(parentLocalId: parent, title: "Pack")
        _ = try store.updateTask(localId: first.localId, patch: TaskPatch(done: true))
        XCTAssertEqual(try XCTUnwrap(try store.task(localId: parent)).percentDone, 0.5, accuracy: 0.001)

        ProgressOverride.setManual(parent, true)
        var patch = TaskPatch()
        patch.percentDone = 0.9
        _ = try store.updateTask(localId: parent, patch: patch)
        _ = try store.updateTask(localId: first.localId, patch: TaskPatch(done: false))
        XCTAssertEqual(try XCTUnwrap(try store.task(localId: parent)).percentDone, 0.9, accuracy: 0.001, "hand-set value wins")

        try store.followSubtaskProgress(taskLocalId: parent)
        XCTAssertEqual(try XCTUnwrap(try store.task(localId: parent)).percentDone, 0, accuracy: 0.001)
        XCTAssertFalse(ProgressOverride.isManual(parent))
    }

    func testTaskLayoutOrderParsesLeniently() {
        XCTAssertEqual(TaskDetailSection.order(from: "comments,bogus,when,comments").prefix(2), [.comments, .when])
        XCTAssertEqual(Set(TaskDetailSection.order(from: "")), Set(TaskDetailSection.allCases))
        var prefs = LocalPreferences.default
        prefs.taskDetailOrder = [.comments] + TaskDetailSection.defaultOrder.filter { $0 != .comments }
        let change = SyncedPreferences.change(from: .default, to: prefs)
        XCTAssertEqual(change?.cria["taskDetailOrder"]?.stringValue?.hasPrefix("comments,details"), true)
        XCTAssertEqual(SyncedPreferences.applying(change?.cria ?? [:], to: .default).taskDetailOrder.first, .comments)
    }

    func testTypedDatePhraseResolves() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Europe/London"))
        let monday = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 12, hour: 10)))
        let friday = try XCTUnwrap(parseDatePhrase("fri", now: monday, calendar: calendar))
        XCTAssertEqual(DueDates.dayKey(friday, calendar: calendar), "2026-10-16")
        XCTAssertFalse(DueDates.hasTimeOfDay(friday))
        XCTAssertTrue(DueDates.hasTimeOfDay(parseDatePhrase("tomorrow at 5pm", now: monday, calendar: calendar)))
        XCTAssertNil(parseDatePhrase("buy milk", now: monday, calendar: calendar))
    }
}
