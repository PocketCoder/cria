import XCTest
@testable import CriaKit

final class ReminderTextTests: XCTestCase {
    func testSpansUseTheLargestWholeUnit() {
        XCTAssertEqual(ReminderText.span(seconds: 86_400), "1 day")
        XCTAssertEqual(ReminderText.span(seconds: -172_800), "2 days")
        XCTAssertEqual(ReminderText.span(seconds: 3_600), "1 hour")
        XCTAssertEqual(ReminderText.span(seconds: 7_200), "2 hours")
        XCTAssertEqual(ReminderText.span(seconds: 5_400), "90 min")
        XCTAssertEqual(ReminderText.span(seconds: 1_800), "30 min")
    }

    func testRelativeText() {
        XCTAssertEqual(ReminderText.relative(period: -86_400, anchor: "due_date"), "1 day before due date")
        XCTAssertEqual(ReminderText.relative(period: 1_800, anchor: "start_date"), "30 min after start date")
        XCTAssertEqual(ReminderText.relative(period: 0, anchor: "due_date"), "at due date")
    }
}
