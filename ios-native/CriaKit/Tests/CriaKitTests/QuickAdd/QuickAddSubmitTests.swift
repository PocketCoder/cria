import XCTest
@testable import CriaKit

final class QuickAddSubmitTests: XCTestCase {
    /// Home (server id 10, red) and Work (20), read back from one store so they carry real local ids.
    private func fixtures(_ extra: [String] = []) throws -> [ProjectRecord] {
        let store = try makeStore()
        let fixtures = [
            #"{"id": 10, "title": "Home", "hex_color": "ff0000"}"#,
            #"{"id": 20, "title": "Work"}"#
        ] + extra
        for json in fixtures {
            try store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json)
        }
        return try store.projects()
    }

    func testCanSubmit() {
        XCTAssertFalse(canSubmitQuickAdd(title: "", projectTitle: nil, projectLocalId: "p1"))
        XCTAssertFalse(canSubmitQuickAdd(title: "x", projectTitle: nil, projectLocalId: nil))
        XCTAssertTrue(canSubmitQuickAdd(title: "x", projectTitle: "Nope", projectLocalId: nil))
        XCTAssertTrue(canSubmitQuickAdd(title: "x", projectTitle: nil, projectLocalId: "p1"))
    }

    func testBuildKeepsSelectedProjectWithoutToken() throws {
        let projects = try fixtures()
        let input = buildQuickAddInput(
            title: "x", projectTitle: nil, projects: projects,
            selectedProjectId: projects[1].localId, fallbackProjectId: projects[0].localId, fields: QuickAddFields()
        )
        XCTAssertEqual(input?.projectLocalId, projects[1].localId)
        XCTAssertEqual(input?.title, "x")
    }

    func testBuildResolvesTokenCaseInsensitively() throws {
        let projects = try fixtures()
        let input = buildQuickAddInput(
            title: "x", projectTitle: "hOmE", projects: projects,
            selectedProjectId: projects[1].localId, fallbackProjectId: nil, fields: QuickAddFields()
        )
        XCTAssertEqual(input?.projectLocalId, projects[0].localId)
    }

    func testUnknownTokenFallsBackAndNoProjectIsNil() throws {
        let projects = try fixtures()
        let fallback = buildQuickAddInput(
            title: "x", projectTitle: "Nope", projects: projects,
            selectedProjectId: projects[1].localId, fallbackProjectId: projects[0].localId, fields: QuickAddFields()
        )
        XCTAssertEqual(fallback?.projectLocalId, projects[0].localId)
        let none = buildQuickAddInput(
            title: "x", projectTitle: "Nope", projects: projects, selectedProjectId: nil, fallbackProjectId: nil, fields: QuickAddFields()
        )
        XCTAssertNil(none)
    }

    func testTitleThatIsOnlyAProjectTokenStaysInSelectedProject() throws {
        let projects = try fixtures()
        let parsed = parseTask("+Work")
        XCTAssertTrue(canSubmitQuickAdd(title: parsed.title, projectTitle: parsed.projectTitle, projectLocalId: projects[0].localId))
        let input = buildQuickAddInput(
            title: parsed.title, projectTitle: parsed.projectTitle, projects: projects,
            selectedProjectId: projects[0].localId, fallbackProjectId: nil, fields: QuickAddFields()
        )
        XCTAssertEqual(input?.title, "+Work")
        XCTAssertEqual(input?.projectLocalId, projects[0].localId)
    }

    func testBuildIncludesOnlySetFields() throws {
        let projects = try fixtures()
        let fields = QuickAddFields(
            description: "  note ", dueDate: "2030-01-01T00:00:00Z", priority: 3, repeatAfter: 0, repeatMode: 1
        )
        let input = try XCTUnwrap(buildQuickAddInput(
            title: "x", projectTitle: nil, projects: projects,
            selectedProjectId: projects[0].localId, fallbackProjectId: nil, fields: fields
        ))
        XCTAssertEqual(input.description, "note")
        XCTAssertEqual(input.dueDate, "2030-01-01T00:00:00Z")
        XCTAssertEqual(input.priority, 3)
        XCTAssertEqual(input.repeatAfter, 0)
        XCTAssertEqual(input.repeatMode, 1)
        let bare = try XCTUnwrap(buildQuickAddInput(
            title: "x", projectTitle: nil, projects: projects,
            selectedProjectId: projects[0].localId, fallbackProjectId: nil, fields: QuickAddFields()
        ))
        XCTAssertNil(bare.description)
        XCTAssertNil(bare.dueDate)
        XCTAssertEqual(bare.priority, 0)
    }

    func testMergeLabelTitles() {
        XCTAssertEqual(mergeLabelTitles(["Home"], ["home", "Work"]), ["Home", "Work"])
        XCTAssertEqual(mergeLabelTitles([], ["a"]), ["a"])
    }

    func testFollowParsed() {
        XCTAssertEqual(followParsed(0, before: nil, after: 3, empty: 0), 3)
        XCTAssertEqual(followParsed(4, before: 3, after: 2, empty: 0), 2)
        XCTAssertEqual(followParsed(3, before: 3, after: nil, empty: 0), 0)
        XCTAssertEqual(followParsed(4, before: 3, after: nil, empty: 0), 4)
        XCTAssertEqual(followParsed(4, before: nil, after: nil, empty: 0), 4)
    }

    func testFollowParsedDropsDateOnceClosingQuoteMakesLineLiteral() {
        let partial = parseTask("\"buy milk tomorrow")
        let closed = parseTask("\"buy milk tomorrow\"")
        let typed = followParsed("", before: nil, after: partial.dueDate, empty: "")
        XCTAssertFalse(typed.isEmpty)
        XCTAssertEqual(followParsed(typed, before: partial.dueDate, after: closed.dueDate, empty: ""), "")
    }

    private func typeOut(_ lines: [String]) -> [String] {
        var picked: [String] = []
        var before: [String] = []
        for line in lines {
            let after = parseTask(line).labelTitles
            picked = followParsedLabels(picked, before: before, after: after)
            before = after
        }
        return picked
    }

    func testFollowParsedLabels() {
        XCTAssertEqual(typeOut(["Fix *w", "Fix *wo", "Fix *work"]), ["work"])
        XCTAssertEqual(typeOut(["\"Fix *bug", "\"Fix *bug\""]), [])
        XCTAssertEqual(typeOut(["*bug Fix", "*bug"]), [])
        XCTAssertEqual(followParsedLabels(["Home", "work"], before: ["work"], after: []), ["Home"])
        XCTAssertEqual(followParsedLabels(["Work"], before: [], after: ["work", "Home"]), ["Work", "Home"])
    }

    func testProjectHelpers() throws {
        let projects = try fixtures()
        XCTAssertEqual(findProject(titled: "WORK", in: projects)?.title, "Work")
        XCTAssertNil(findProject(titled: "nope", in: projects))
        let typed = resolveProjectChip(parsedProjectTitle: "Typed", projects: projects, projectLocalId: projects[0].localId)
        XCTAssertEqual(typed.title, "No project “Typed”", "an unknown name says so instead of looking matched")
        XCTAssertNil(typed.color)
        XCTAssertEqual(resolveProjectChip(parsedProjectTitle: "home", projects: projects, projectLocalId: nil).title, "Home")
        let chosen = resolveProjectChip(parsedProjectTitle: nil, projects: projects, projectLocalId: projects[0].localId)
        XCTAssertEqual(chosen.title, "Home")
        XCTAssertEqual(chosen.color, "ff0000")
        XCTAssertNil(resolveProjectChip(parsedProjectTitle: nil, projects: projects, projectLocalId: nil).title)
    }

    func testTypedProjectMatchesIgnoringEmojiPunctuationAndExtraWords() throws {
        let projects = try fixtures([
            #"{"id": 30, "title": "Flat 🏠"}"#, #"{"id": 31, "title": "Shopping list"}"#,
            #"{"id": 32, "title": "The Garden"}"#, #"{"id": 33, "title": "Car: MOT"}"#, #"{"id": 34, "title": "Car: tax"}"#
        ])
        XCTAssertEqual(findProject(titled: "flat", in: projects)?.title, "Flat 🏠")
        XCTAssertEqual(findProject(titled: "shopping", in: projects)?.title, "Shopping list", "a unique prefix")
        XCTAssertEqual(findProject(titled: "garden", in: projects)?.title, "The Garden", "a unique whole word")
        XCTAssertNil(findProject(titled: "car", in: projects), "two projects fit: no guess")
        XCTAssertNil(findProject(titled: "gard", in: projects), "part of a later word is not enough")
    }

    func testFallbackProject() throws {
        let projects = try fixtures()
        XCTAssertNil(pickFallbackProjectId(projects: [], selectedLocalId: "p1", defaultServerProjectId: 10))
        let home = projects[0].localId
        let work = projects[1].localId
        func pick(_ selected: String?, _ serverId: Int?) -> String? {
            pickFallbackProjectId(projects: projects, selectedLocalId: selected, defaultServerProjectId: serverId)
        }
        XCTAssertEqual(pick(work, 10), work)
        XCTAssertEqual(pick("pseudo", 20), work)
        XCTAssertEqual(pick(nil, nil), home)
        XCTAssertEqual(pick(nil, 999), home)
    }

    func testPersistCreatesTaskLabelsAndRepeat() throws {
        let store = try makeStore()
        let home = try seedProject(store, title: "Home")
        var input = TaskInput(title: "Water plants", projectLocalId: home)
        input.repeatAfter = 86_400
        let created = try store.persistQuickAdd(input, labelTitles: ["garden", "Garden"])

        XCTAssertEqual(created.repeatAfter, 86_400)
        XCTAssertEqual(try store.labels(forTask: created.localId).map(\.title), ["garden"])
        XCTAssertEqual(try outboxEntries(store, entity: "task").map(\.operation), ["create"])
    }

    func testPersistCreatesMissingLabelsAndAddsReminders() throws {
        let store = try makeStore()
        let home = try seedProject(store, title: "Home")
        _ = try store.createLabel(title: "Errand")
        let input = TaskInput(title: "Post parcel", projectLocalId: home, dueDate: "2026-05-28T09:00:00Z")
        let created = try store.persistQuickAdd(
            input, labelTitles: ["errand", "Urgent"],
            reminders: [.beforeDue(seconds: 3_600), .beforeDue(seconds: 3_600), .atTime("2026-05-27T18:00:00Z")]
        )

        XCTAssertEqual(Set(try store.labels(forTask: created.localId).map(\.title)), ["Errand", "Urgent"])
        XCTAssertEqual(try store.labels().filter { $0.title.lowercased() == "errand" }.count, 1)
        let reminders = try store.reminders(forTask: created.localId)
        XCTAssertEqual(reminders.count, 2)
        let relative = reminders.first { $0.relativeTo == "due_date" }
        XCTAssertEqual(relative?.relativePeriod, -3_600)
        XCTAssertEqual(relative?.reminderAt.flatMap(DueDates.parse), DueDates.parse("2026-05-28T08:00:00Z"))
        XCTAssertTrue(reminders.contains { $0.relativeTo == nil && $0.reminderAt == "2026-05-27T18:00:00Z" })
    }

    func testPersistDropsRelativeRemindersWithoutDueDate() throws {
        let store = try makeStore()
        let home = try seedProject(store, title: "Home")
        let created = try store.persistQuickAdd(
            TaskInput(title: "Someday", projectLocalId: home), labelTitles: [],
            reminders: [.beforeDue(seconds: 0), .atTime("2026-06-01T08:00:00Z")]
        )
        XCTAssertEqual(try store.reminders(forTask: created.localId).map(\.reminderAt), ["2026-06-01T08:00:00Z"])
    }

    func testDatePresets() {
        func day(_ preset: QuickAddDatePreset, _ now: Date = quickAddNow) -> String {
            preset.iso(now: now, calendar: utcCalendar)
        }
        XCTAssertEqual(day(.today), "2026-05-27T00:00:00Z")
        XCTAssertEqual(day(.tomorrow), "2026-05-28T00:00:00Z")
        XCTAssertEqual(day(.thisWeekend), "2026-05-30T00:00:00Z")
        XCTAssertEqual(day(.nextWeek), "2026-06-03T00:00:00Z")
        let saturday = DueDates.parse("2026-05-30T10:00:00Z") ?? Date()
        XCTAssertEqual(day(.thisWeekend, saturday), "2026-05-30T00:00:00Z")
        XCTAssertEqual(QuickAddReminder.beforeDue(seconds: 86_400).input.period, -86_400)
        XCTAssertFalse(QuickAddReminder.atTime("2026-05-30T10:00:00Z").needsDueDate)
    }
}
