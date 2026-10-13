import XCTest
@testable import CriaKit

/// Settings > Customise: storage, what follows the account, and the behaviour the rules change.
final class CustomisationTests: XCTestCase {
    override func tearDown() {
        CriaRules.current = .standard
        super.tearDown()
    }

    private func london() throws -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Europe/London"))
        return calendar
    }

    func testCustomisationRoundTripsAndReadsLeniently() {
        var prefs = LocalPreferences.default
        prefs.custom.tabs = [.inbox, .today]
        prefs.custom.swipeLeft = .schedule
        prefs.custom.quickAddActions = [.labels, .date]
        prefs.custom.weekendDay = 1
        let codec = PreferencesCodec()
        XCTAssertEqual(codec.decode(codec.encode(prefs)), prefs)

        let odd = Customisation(values: [
            "tabs": .string("search,inbox,inbox,bogus,today,upcoming,favorites"), "swipeLeft": .string("explode"),
            "nextWeekDay": .number(12), "weekendDay": .number(3)
        ])
        XCTAssertEqual(odd.tabs, [.inbox, .today, .upcoming], "only choosable tabs, no repeats, at most three")
        XCTAssertEqual(odd.swipeLeft, .delete)
        XCTAssertEqual(odd.nextWeekDay, 0)
        XCTAssertEqual(odd.weekendDay, 7)
        XCTAssertEqual(odd.barTabs, [.inbox, .today, .upcoming, .browse, .search])
    }

    func testLaunchTabFallsBackWhenTheHomeViewIsNotInTheBar() {
        var custom = Customisation()
        custom.tabs = [.upcoming]
        custom.homeView = .today
        XCTAssertEqual(custom.launchTab, .upcoming)
        custom.homeView = .browse
        XCTAssertEqual(custom.launchTab, .browse)
    }

    func testHomeViewSyncsOnlyWhileTheSwitchIsOn() {
        var new = LocalPreferences.default
        new.custom.homeView = .upcoming
        new.custom.swipeRight = .star
        let change = SyncedPreferences.change(from: .default, to: new)
        XCTAssertEqual(change?.cria["homeView"]?.stringValue, "upcoming")
        XCTAssertEqual(change?.cria["swipeRight"]?.stringValue, "star")
        XCTAssertNil(change?.cria["syncHomeView"], "the switch itself stays on the device")

        var local = LocalPreferences.default
        local.custom.syncHomeView = false
        local.custom.homeView = .browse
        let applied = SyncedPreferences.applying(["homeView": .string("upcoming"), "swipeLeft": .string("star")], to: local)
        XCTAssertEqual(applied.custom.homeView, .browse)
        XCTAssertEqual(applied.custom.swipeLeft, .star)

        var turnedOn = local
        turnedOn.custom.syncHomeView = true
        XCTAssertEqual(SyncedPreferences.change(from: local, to: turnedOn)?.cria["homeView"]?.stringValue, "browse")
    }

    func testNextWeekAndWeekendFollowTheRules() throws {
        let calendar = try london()
        // Wednesday 14 October 2026.
        let wednesday = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 14, hour: 10)))
        func day(_ phrase: String) -> String? {
            parseDatePhrase(phrase, now: wednesday, calendar: calendar).flatMap { DueDates.dayKey($0, calendar: calendar) }
        }
        XCTAssertEqual(day("next week"), "2026-10-21")
        XCTAssertEqual(day("weekend"), "2026-10-17")
        CriaRules.current = CriaRules(nextWeekWeekday: 2, weekendWeekday: 1, resetsSubtasksOnRepeat: false)
        XCTAssertEqual(day("next week"), "2026-10-19", "Monday of next week")
        XCTAssertEqual(day("this weekend"), "2026-10-18", "Sunday")
        let preset = QuickAddDatePreset.nextWeek.iso(now: wednesday, calendar: calendar)
        XCTAssertEqual(DueDates.dayKey(preset, calendar: calendar), "2026-10-19")
    }

    func testDetectDatesOffKeepsTheDateInTheTitle() {
        let parsed = parseQuickAddTask("Call mum tomorrow", detectDates: false)
        XCTAssertEqual(parsed.title, "Call mum tomorrow")
        XCTAssertNil(parsed.dueDate)
    }

    func testCompletingARepeatingTaskResetsItsSubtasksWhenOn() throws {
        let store = try makeStore()
        try seedProject(store)
        let parent = try seedSyncedTask(store, serverId: 1, title: "Weekly shop")
        var repeating = TaskPatch()
        repeating.repeatAfter = 604_800
        _ = try store.updateTask(localId: parent, patch: repeating)
        let child = try store.createSubtask(parentLocalId: parent, title: "Milk")
        _ = try store.updateTask(localId: child.localId, patch: TaskPatch(done: true))

        _ = try store.updateTask(localId: parent, patch: TaskPatch(done: true))
        XCTAssertEqual(try store.task(localId: child.localId)?.done, true, "off by default")

        CriaRules.current = CriaRules(nextWeekWeekday: nil, weekendWeekday: 7, resetsSubtasksOnRepeat: true)
        _ = try store.updateTask(localId: parent, patch: TaskPatch(done: true))
        XCTAssertEqual(try store.task(localId: child.localId)?.done, false)
    }
}
