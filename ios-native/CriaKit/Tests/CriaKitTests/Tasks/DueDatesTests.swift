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
