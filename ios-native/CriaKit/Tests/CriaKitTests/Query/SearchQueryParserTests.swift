import XCTest
@testable import CriaKit

/// Port of tests/unit/searchQueryParser.test.ts. "Now" is 9 Jun 2026 20:00 in Los Angeles, which is already
/// 10 Jun in UTC, so the tests prove the parser uses the local calendar day.
final class SearchQueryParserTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles") ?? .gmt
        return calendar
    }

    private func parse(_ input: String) throws -> SearchQuery {
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 9, hour: 20)))
        return parseSearchQuery(input, now: now, calendar: calendar)
    }

    func testParsesPlainText() throws {
        let query = try parse("buy milk")
        XCTAssertEqual(query.text, "buy milk")
        XCTAssertEqual(query.tokens, [.text("buy milk")])
        XCTAssertNil(query.dueDateStart)
        XCTAssertNil(query.dueDateEnd)
        XCTAssertNil(query.labelTitle)
        XCTAssertNil(query.priority)
    }

    func testParsesEmptyString() throws {
        let query = try parse("")
        XCTAssertEqual(query.text, "")
        XCTAssertEqual(query.tokens, [])
    }

    func testNormalisesWhitespaceOnlyInputToEmptyText() throws {
        XCTAssertEqual(try parse("   ").text, "")
    }

    func testParsesSimpleLabel() throws {
        let query = try parse("#urgent")
        XCTAssertEqual(query.labelTitle, "urgent")
        XCTAssertTrue(query.tokens.contains(.label(text: "#urgent", title: "urgent")))
    }

    func testParsesQuotedMultiWordLabel() throws {
        XCTAssertEqual(try parse("#\"My Label\"").labelTitle, "My Label")
    }

    func testStripsLabelFromText() throws {
        let query = try parse("meeting #work")
        XCTAssertEqual(query.text, "meeting")
        XCTAssertEqual(query.tokens, [.text("meeting "), .label(text: "#work", title: "work")])
    }

    func testIgnoresHashWithNoLabelText() throws {
        let query = try parse("just a #")
        XCTAssertEqual(query.text, "just a #")
        XCTAssertNil(query.labelTitle)
    }

    func testParsesPriority() throws {
        let query = try parse("!3")
        XCTAssertEqual(query.priority, 3)
        XCTAssertTrue(query.tokens.contains(.priority(text: "!3", value: 3)))
    }

    func testStripsPriorityFromText() throws {
        XCTAssertEqual(try parse("task !1").text, "task")
    }

    func testTakesHighestPriorityWhenMultipleAreGiven() throws {
        XCTAssertEqual(try parse("!3 !1").priority, 3)
    }

    func testTodayIsStartAndEndOfSameLocalCalendarDay() throws {
        let query = try parse("today")
        XCTAssertEqual(query.dueDateStart, "2026-06-09T00:00:00.000Z")
        XCTAssertEqual(query.dueDateEnd, "2026-06-09T23:59:59.999Z")
    }

    func testTomorrowIsStartAndEndOfNextCalendarDay() throws {
        let query = try parse("tomorrow")
        XCTAssertEqual(query.dueDateStart, "2026-06-10T00:00:00.000Z")
        XCTAssertEqual(query.dueDateEnd, "2026-06-10T23:59:59.999Z")
    }

    func testThisWeekCoversThroughEndOfWeekWithNoLowerBound() throws {
        let query = try parse("this week")
        XCTAssertNil(query.dueDateStart)
        // 9 Jun 2026 is a Tuesday; the week ends on Sunday 14 Jun.
        XCTAssertEqual(query.dueDateEnd, "2026-06-14T23:59:59.999Z")
    }

    func testSoonIsNextFourteenDaysWithNoLowerBound() throws {
        let query = try parse("soon")
        XCTAssertNil(query.dueDateStart)
        XCTAssertEqual(query.dueDateEnd, "2026-06-23T23:59:59.999Z")
    }

    func testOnlyTheFirstDatePhraseWins() throws {
        XCTAssertEqual(try parse("today tomorrow").dueDateStart, "2026-06-09T00:00:00.000Z")
    }

    func testCombinedTextLabelPriorityAndDate() throws {
        let query = try parse("buy milk #groceries !1 tomorrow")
        XCTAssertEqual(query.text, "buy milk")
        XCTAssertEqual(query.labelTitle, "groceries")
        XCTAssertEqual(query.priority, 1)
        XCTAssertEqual(query.dueDateStart, "2026-06-10T00:00:00.000Z")
    }

    func testWeekdayAndRelativePhrases() throws {
        // Tuesday 9 Jun: friday is 12 Jun, "next tuesday" skips today, "in 2 weeks" is 23 Jun.
        XCTAssertEqual(try parse("friday").dueDateStart, "2026-06-12T00:00:00.000Z")
        XCTAssertEqual(try parse("next tuesday").dueDateStart, "2026-06-16T00:00:00.000Z")
        XCTAssertEqual(try parse("in 2 weeks").dueDateStart, "2026-06-23T00:00:00.000Z")
        XCTAssertEqual(try parse("2026-07-01").dueDateEnd, "2026-07-01T23:59:59.999Z")
    }
}
