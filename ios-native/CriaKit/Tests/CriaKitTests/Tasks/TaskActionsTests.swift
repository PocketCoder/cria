import XCTest
@testable import CriaKit

final class DeferPresetTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .gmt
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    // Wed 2026-05-27 10:00 in New York.
    private var now: Date { DueDates.parse("2026-05-27T14:00:00Z") ?? Date() }

    private func defer_(_ preset: DeferPreset, _ due: String?, now: Date? = nil) -> String {
        preset.dueDate(from: due, now: now ?? self.now, calendar: calendar)
    }

    func testNoDueDateCountsFromToday() {
        XCTAssertEqual(defer_(.oneDay, nil), "2026-05-28T00:00:00Z")
        XCTAssertEqual(defer_(.threeDays, nil), "2026-05-30T00:00:00Z")
        XCTAssertEqual(defer_(.oneWeek, nil), "2026-06-03T00:00:00Z")
    }

    func testFutureDueCountsFromTheDueDay() {
        XCTAssertEqual(defer_(.oneWeek, "2026-06-01T00:00:00Z"), "2026-06-08T00:00:00Z")
        XCTAssertEqual(defer_(.oneDay, "2026-05-27T00:00:00Z"), "2026-05-28T00:00:00Z")
    }

    func testOverdueCountsFromToday() {
        XCTAssertEqual(defer_(.oneDay, "2026-05-20T00:00:00Z"), "2026-05-28T00:00:00Z")
        XCTAssertEqual(defer_(.oneWeek, "2026-01-01T00:00:00Z"), "2026-06-03T00:00:00Z")
    }

    func testNextMondayIgnoresTheCurrentDue() {
        XCTAssertEqual(defer_(.nextMonday, nil), "2026-06-01T00:00:00Z")
        XCTAssertEqual(defer_(.nextMonday, "2026-07-15T00:00:00Z"), "2026-06-01T00:00:00Z")
        // On a Monday it is the Monday after, never today.
        let monday = DueDates.parse("2026-06-01T14:00:00Z")
        XCTAssertEqual(defer_(.nextMonday, nil, now: monday), "2026-06-08T00:00:00Z")
    }

    func testTimedDueKeepsItsTimeOfDay() {
        // 17:00 in New York is 21:00Z in May (EDT).
        XCTAssertEqual(defer_(.oneDay, "2026-05-29T21:00:00Z"), "2026-05-30T21:00:00Z")
        XCTAssertEqual(defer_(.oneDay, "2026-05-20T21:00:00Z"), "2026-05-28T21:00:00Z")
        XCTAssertEqual(defer_(.nextMonday, "2026-05-29T21:00:00Z"), "2026-06-01T21:00:00Z")
    }

    func testTitlesAndCases() {
        XCTAssertEqual(DeferPreset.allCases.map(\.title), ["In 1 day", "In 3 days", "In 1 week", "Next Monday"])
    }
}

final class DuplicateTaskTests: XCTestCase {
    func testCopiesFieldsLabelsAndRemindersInOneTransaction() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        var input = TaskInput(
            title: "Original", projectLocalId: project, description: "<p>Notes</p>", dueDate: "2099-03-01T12:00:00Z", priority: 3
        )
        input.repeatAfter = 86_400
        let original = try store.createTask(input)
        var patch = TaskPatch(done: nil, isFavorite: true)
        patch.percentDone = 0.4
        patch.hexColor = "#E8590C"
        patch.startDate = "2099-02-01T00:00:00Z"
        try store.updateTask(localId: original.localId, patch: patch)
        let label = try store.createLabel(title: "Home")
        try store.toggleTaskLabel(taskLocalId: original.localId, labelLocalId: label.localId)
        try store.addReminder(taskLocalId: original.localId, ReminderInput(period: -3600, relativeTo: .dueDate))

        let copy = try store.duplicateTask(localId: original.localId)

        XCTAssertNotEqual(copy.localId, original.localId)
        XCTAssertEqual(copy.title, "Original")
        XCTAssertEqual(copy.projectLocalId, project)
        XCTAssertEqual(copy.description, "<p>Notes</p>")
        XCTAssertEqual(copy.dueDate, "2099-03-01T12:00:00Z")
        XCTAssertEqual(copy.startDate, "2099-02-01T00:00:00Z")
        XCTAssertEqual(copy.priority, 3)
        XCTAssertEqual(copy.percentDone, 0.4, accuracy: 0.0001)
        XCTAssertEqual(copy.hexColor, "e8590c")
        XCTAssertEqual(copy.repeatAfter, 86_400)
        XCTAssertFalse(copy.isFavorite)
        XCTAssertFalse(copy.done)
        XCTAssertNil(copy.serverId)
        XCTAssertEqual(try store.labels(forTask: copy.localId).map(\.title), ["Home"])
        let reminders = try store.reminders(forTask: copy.localId)
        XCTAssertEqual(reminders.map(\.relativePeriod), [-3600])
        XCTAssertEqual(reminders.map(\.relativeTo), ["due_date"])
        // The original is untouched.
        XCTAssertEqual(try store.labels(forTask: original.localId).count, 1)
        XCTAssertEqual(try store.reminders(forTask: original.localId).count, 1)
    }

    func testQueuesCreateThenLabelThenReminderUpdate() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let original = try store.createTask(
            TaskInput(title: "Original", projectLocalId: project, dueDate: "2099-03-01T12:00:00Z")
        )
        let label = try store.createLabel(title: "Home")
        try store.toggleTaskLabel(taskLocalId: original.localId, labelLocalId: label.localId)
        try store.addReminder(taskLocalId: original.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))

        let copy = try store.duplicateTask(localId: original.localId)

        let taskOps = try outboxEntries(store, entity: "task").filter { $0.localId == copy.localId }
        XCTAssertEqual(taskOps.map(\.operation), ["create", "update"])
        let create = try payloadObject(try XCTUnwrap(taskOps.first))
        XCTAssertEqual(create["title"] as? String, "Original")
        XCTAssertEqual(create["due_date"] as? String, "2099-03-01T12:00:00Z")
        let links = try outboxEntries(store, entity: "task_label").filter { $0.localId.hasPrefix(copy.localId) }
        XCTAssertEqual(links.map(\.operation), ["create"])
    }

    func testWithoutRemindersQueuesOnlyTheCreate() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let original = try store.createTask(TaskInput(title: "Plain", projectLocalId: project))
        let copy = try store.duplicateTask(localId: original.localId)
        let ops = try outboxEntries(store, entity: "task").filter { $0.localId == copy.localId }
        XCTAssertEqual(ops.map(\.operation), ["create"])
    }

    func testRelationsAndAssigneesAreNotCopied() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let original = try store.createTask(TaskInput(title: "Parent", projectLocalId: project))
        try store.createSubtask(parentLocalId: original.localId, title: "Child")
        try store.addAssignee(taskLocalId: original.localId, userId: 5, username: "sam")

        let copy = try store.duplicateTask(localId: original.localId)

        XCTAssertEqual(try store.relations(forTask: copy.localId).count, 0)
        XCTAssertEqual(try store.assignees(forTask: copy.localId).count, 0)
    }

    func testMissingTaskThrowsAndQueuesNothing() throws {
        let store = try makeStore()
        XCTAssertThrowsError(try store.duplicateTask(localId: "nope"))
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, 0)
    }
}

final class TaskLinkTests: XCTestCase {
    func testTaskURLNeedsServerAndSyncedTask() {
        XCTAssertEqual(TaskLinks.taskURL(base: "https://v.example.com", taskServerId: 42)?.absoluteString, "https://v.example.com/tasks/42")
        XCTAssertEqual(
            TaskLinks.taskURL(base: "https://v.example.com/", taskServerId: 42)?.absoluteString, "https://v.example.com/tasks/42"
        )
        XCTAssertNil(TaskLinks.taskURL(base: "https://v.example.com", taskServerId: nil))
        XCTAssertNil(TaskLinks.taskURL(base: nil, taskServerId: 42))
        XCTAssertNil(TaskLinks.taskURL(base: "", taskServerId: 42))
    }

    func testCommentURLCarriesAnchor() {
        XCTAssertEqual(
            TaskLinks.commentURL(base: "https://v.example.com", taskServerId: 42, commentServerId: 7)?.absoluteString,
            "https://v.example.com/tasks/42#comment-7"
        )
        XCTAssertNil(TaskLinks.commentURL(base: "https://v.example.com", taskServerId: 42, commentServerId: 0))
        XCTAssertNil(TaskLinks.commentURL(base: "https://v.example.com", taskServerId: nil, commentServerId: 7))
    }

    func testServicesBuildLinksFromTheRememberedServer() async throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 1)
        let blobs = FileManager.default.temporaryDirectory.appendingPathComponent("blobs-\(UUID().uuidString)")
        let services = await AppServices(api: ApiClient(serverURL: "https://v.example.com/"), store: store, blobDirectory: blobs)
        let defaults = UserDefaults.standard
        let saved = defaults.string(forKey: AppServices.serverBaseKey)
        defer {
            if let saved {
                defaults.set(saved, forKey: AppServices.serverBaseKey)
            } else {
                defaults.removeObject(forKey: AppServices.serverBaseKey)
            }
        }
        await services.rememberServerBase()

        let json = taskJSON(id: 99, title: "Synced")
        _ = try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        let synced = try XCTUnwrap(try store.tasks(matching: TaskQuery(projectLocalId: project)).first)
        let local = try store.createTask(TaskInput(title: "Local", projectLocalId: project))

        XCTAssertEqual(services.taskWebURL(synced)?.absoluteString, "https://v.example.com/tasks/99")
        XCTAssertNil(services.taskWebURL(local))
        XCTAssertEqual(services.commentWebURL(task: synced, commentServerId: 3)?.absoluteString, "https://v.example.com/tasks/99#comment-3")
    }
}

final class RowSignalTests: XCTestCase {
    func testChecklistCountsTickedAndTotal() {
        let html = """
            <ul><li><label><input type="checkbox" checked="checked"><span></span></label><div>a</div></li>
            <li><label><input type="checkbox"><span></span></label><div>b</div></li>
            <li><label><input type="checkbox" checked><span></span></label><div>c</div></li></ul>
            """
        XCTAssertEqual(ChecklistCount(html: html), ChecklistCount(checked: 2, total: 3))
        XCTAssertEqual(ChecklistCount(html: "<p>none</p>"), .none)
        XCTAssertEqual(ChecklistCount(html: nil), .none)
    }

    func testListItemsCarryAttachmentAndChecklistSignals() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let plain = try store.createTask(TaskInput(title: "Plain", projectLocalId: project))
        let list = try store.createTask(TaskInput(
            title: "List", projectLocalId: project, description: #"<input type="checkbox" checked="checked"><input type="checkbox">"#
        ))
        let items = try store.taskItems(.project(project))
        let byId = Dictionary(uniqueKeysWithValues: items.map { ($0.task.localId, $0) })
        XCTAssertEqual(byId[list.localId]?.checklist, ChecklistCount(checked: 1, total: 2))
        XCTAssertEqual(byId[plain.localId]?.checklist, ChecklistCount.none)
        XCTAssertEqual(byId[plain.localId]?.hasAttachments, false)
    }
}

final class TaskColourPatchTests: XCTestCase {
    func testColourIsStoredWithoutHashAndClearedByEmptyString() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Colour", projectLocalId: project))
        var patch = TaskPatch()
        patch.hexColor = "#AbCdEf"
        XCTAssertEqual(try store.updateTask(localId: task.localId, patch: patch).hexColor, "abcdef")
        let payload = try payloadObject(try XCTUnwrap(try outboxEntries(store, entity: "task").last))
        XCTAssertEqual(payload["hex_color"] as? String, "abcdef")
        patch.hexColor = ""
        XCTAssertNil(try store.updateTask(localId: task.localId, patch: patch).hexColor)
    }
}
