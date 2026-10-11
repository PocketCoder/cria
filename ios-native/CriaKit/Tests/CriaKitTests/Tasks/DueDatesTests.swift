import XCTest
@testable import CriaKit

final class DueDatesTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .gmt
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    // Wed 2026-05-27 10:00 in New York.
    private var now: Date { DueDates.parse("2026-05-27T14:00:00Z") ?? Date() }

    func testAllDayKeepsPickedDayWestOfUTC() {
        XCTAssertFalse(DueDates.hasTimeOfDay("2026-05-28T00:00:00Z"))
        XCTAssertEqual(DueDates.dayKey("2026-05-28T00:00:00Z", calendar: calendar), "2026-05-28")
    }

    func testTimedUsesLocalDay() {
        XCTAssertTrue(DueDates.hasTimeOfDay("2026-05-29T01:30:00Z"))
        XCTAssertEqual(DueDates.dayKey("2026-05-29T01:30:00Z", calendar: calendar), "2026-05-28")
    }

    func testParsesFractionalSeconds() {
        XCTAssertNotNil(DueDates.parse("2026-05-28T10:00:00.123Z"))
        XCTAssertNil(DueDates.parse("not a date"))
    }

    func testOverdueRules() {
        XCTAssertTrue(DueDates.isOverdue("2026-05-26T00:00:00Z", now: now, calendar: calendar))
        XCTAssertFalse(DueDates.isOverdue("2026-05-27T00:00:00Z", now: now, calendar: calendar))
        XCTAssertTrue(DueDates.isOverdue("2026-05-27T12:00:00Z", now: now, calendar: calendar))
        XCTAssertFalse(DueDates.isOverdue("2026-05-27T20:00:00Z", now: now, calendar: calendar))
    }

    func testLabels() {
        XCTAssertEqual(DueDates.label("2026-05-27T00:00:00Z", now: now, calendar: calendar), "Today")
        XCTAssertEqual(DueDates.label("2026-05-28T00:00:00Z", now: now, calendar: calendar), "Tomorrow")
        XCTAssertEqual(DueDates.label("2026-05-26T00:00:00Z", now: now, calendar: calendar), "Yesterday")
        XCTAssertEqual(DueDates.label("2026-05-30T00:00:00Z", now: now, calendar: calendar), "Saturday")
        XCTAssertEqual(DueDates.label("2026-06-10T00:00:00Z", now: now, calendar: calendar), "10 Jun")
        XCTAssertEqual(DueDates.label("2026-05-28T21:00:00Z", now: now, calendar: calendar), "Tomorrow 17:00")
    }
}

final class DueDateWritingTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .gmt
        return calendar
    }

    func testAllDayWritesUTCMidnightOfTheLocalDay() throws {
        // 22:00 on 27 May in New York is already 28 May in UTC; the picked day is still the 27th.
        let evening = try XCTUnwrap(DueDates.parse("2026-05-28T02:00:00Z"))
        XCTAssertEqual(DueDates.allDayISO(for: evening, calendar: calendar), "2026-05-27T00:00:00Z")
    }

    func testTimedMovesOffUTCMidnight() throws {
        let midnight = try XCTUnwrap(DueDates.parse("2026-05-28T00:00:00Z"))
        let written = DueDates.timedISO(midnight)
        XCTAssertEqual(written, "2026-05-28T00:00:01Z")
        XCTAssertTrue(DueDates.hasTimeOfDay(written))
        XCTAssertEqual(DueDates.timedISO(try XCTUnwrap(DueDates.parse("2026-05-28T13:30:00Z"))), "2026-05-28T13:30:00Z")
    }

    func testPickerDateRoundTripsAllDay() throws {
        let picked = try XCTUnwrap(DueDates.pickerDate("2026-05-27T00:00:00Z", calendar: calendar))
        XCTAssertEqual(DueDates.allDayISO(for: picked, calendar: calendar), "2026-05-27T00:00:00Z")
    }
}

final class DueDatesDisplayTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    private let now = DueDates.parse("2026-05-27T10:00:00Z") ?? Date()

    func testFarDatesFollowTheDateFormat() {
        let iso = "2026-07-04T00:00:00Z"
        XCTAssertEqual(DueDates.label(iso, now: now, calendar: calendar), "4 Jul")
        XCTAssertEqual(DueDates.label(iso, now: now, calendar: calendar, display: DateDisplay(dateFormat: .iso)), "2026-07-04")
        XCTAssertEqual(DueDates.label(iso, now: now, calendar: calendar, display: DateDisplay(dateFormat: .american)), "07/04/2026")
        XCTAssertEqual(DueDates.label(iso, now: now, calendar: calendar, display: DateDisplay(dateFormat: .european)), "04/07/2026")
    }

    func testWordsStayWordsWhateverTheFormat() {
        let display = DateDisplay(dateFormat: .iso, timeFormat: .h12)
        XCTAssertEqual(DueDates.label("2026-05-27T00:00:00Z", now: now, calendar: calendar, display: display), "Today")
    }

    func testTimeFollowsTheTimeFormat() {
        let iso = "2026-05-27T14:30:00Z"
        XCTAssertEqual(DueDates.label(iso, now: now, calendar: calendar), "Today 14:30")
        let twelve = DueDates.label(iso, now: now, calendar: calendar, display: DateDisplay(timeFormat: .h12))
        XCTAssertTrue(twelve.hasPrefix("Today 2:30"), twelve)
    }

    func testFullLabel() throws {
        let date = try XCTUnwrap(DueDates.parse("2026-07-04T14:30:00Z"))
        XCTAssertEqual(DueDates.fullLabel(date, calendar: calendar), "4 Jul 2026 14:30")
        XCTAssertEqual(DueDates.fullLabel(date, calendar: calendar, display: DateDisplay(dateFormat: .iso)), "2026-07-04 14:30")
    }
}
