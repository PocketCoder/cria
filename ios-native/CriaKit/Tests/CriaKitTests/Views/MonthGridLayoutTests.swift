import XCTest
@testable import CriaKit

final class MonthGridLayoutTests: XCTestCase {
    private func calendar(firstWeekday: Int) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        calendar.firstWeekday = firstWeekday
        return calendar
    }

    private func date(_ year: Int, _ month: Int, _ day: Int, in calendar: Calendar) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day)) ?? Date(timeIntervalSince1970: 0)
    }

    func testFebruary2027StartingMondayIsFourWeeks() {
        let cal = calendar(firstWeekday: 2)
        let days = MonthGridLayout.days(forMonthContaining: date(2027, 2, 14, in: cal), calendar: cal)
        // 1 February 2027 is a Monday and the 28th a Sunday.
        XCTAssertEqual(days.count, 28)
        XCTAssertEqual(days.first, date(2027, 2, 1, in: cal))
        XCTAssertEqual(days.last, date(2027, 2, 28, in: cal))
    }

    func testOctober2026PadsBothEnds() {
        let cal = calendar(firstWeekday: 2)
        let days = MonthGridLayout.days(forMonthContaining: date(2026, 10, 20, in: cal), calendar: cal)
        // 1 October 2026 is a Thursday, the 31st a Saturday.
        XCTAssertEqual(days.count, 35)
        XCTAssertEqual(days.first, date(2026, 9, 28, in: cal))
        XCTAssertEqual(days.last, date(2026, 11, 1, in: cal))
    }

    func testSundayStartShiftsTheGrid() {
        let cal = calendar(firstWeekday: 1)
        let days = MonthGridLayout.days(forMonthContaining: date(2026, 10, 20, in: cal), calendar: cal)
        XCTAssertEqual(days.first, date(2026, 9, 27, in: cal))
        XCTAssertEqual(days.count % 7, 0)
    }
}
