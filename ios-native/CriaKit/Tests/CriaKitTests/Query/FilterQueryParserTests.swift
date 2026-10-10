import XCTest
@testable import CriaKit

/// Port of tests/unit/filterQueryParser.test.ts.
final class FilterQueryParserTests: XCTestCase {
    private struct ShapeError: Error {}

    private let now = Date(timeIntervalSince1970: 1_781_000_000)

    private func parse(_ input: String) throws -> FilterQuery {
        try parseFilterQuery(input, now: now)
    }

    private func clause(_ node: FilterNode?, file: StaticString = #filePath, line: UInt = #line) throws -> FilterClause {
        guard case .clause(let value) = try XCTUnwrap(node, file: file, line: line) else {
            XCTFail("expected clause", file: file, line: line)
            throw ShapeError()
        }
        return value
    }

    private func group(_ node: FilterNode?, file: StaticString = #filePath, line: UInt = #line) throws -> FilterGroup {
        guard case .group(let value) = try XCTUnwrap(node, file: file, line: line) else {
            XCTFail("expected group", file: file, line: line)
            throw ShapeError()
        }
        return value
    }

    func testReturnsNilAstForEmptyInput() throws {
        let query = try parse("")
        XCTAssertNil(query.ast)
        XCTAssertFalse(query.includeNulls)
    }

    func testReturnsNilAstForWhitespaceOnlyInput() throws {
        XCTAssertNil(try parse("   ").ast)
    }

    func testSimpleIntegerMatch() throws {
        let parsed = try clause(try parse("priority = 4").ast)
        XCTAssertEqual(parsed.field, "priority")
        XCTAssertEqual(parsed.comparison, .equal)
        XCTAssertEqual(parsed.value, .number(4))
    }

    func testRelativeDateMathEvaluation() throws {
        let parsed = try clause(try parse("dueDate < now").ast)
        XCTAssertEqual(parsed.field, "dueDate")
        XCTAssertEqual(parsed.comparison, .less)
        XCTAssertEqual(parsed.value, .dateMath(value: "now", resolved: QueryDates.isoString(now)))
    }

    func testDateMathOffsetsResolve() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let base = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 6, day: 9, hour: 12)))
        let query = try parseFilterQuery("dueDate < now+1w && dueDate > now-2d && dueDate < now+1m", now: base, calendar: calendar)
        let outer = try group(query.ast)
        let inner = try group(outer.children[0])
        XCTAssertEqual(try clause(inner.children[0]).value, .dateMath(value: "now+1w", resolved: "2026-06-16T12:00:00.000Z"))
        XCTAssertEqual(try clause(inner.children[1]).value, .dateMath(value: "now-2d", resolved: "2026-06-07T12:00:00.000Z"))
        XCTAssertEqual(try clause(outer.children[1]).value, .dateMath(value: "now+1m", resolved: "2026-07-09T12:00:00.000Z"))
    }

    func testCompoundLogic() throws {
        let parsed = try group(try parse("done = false && priority >= 3").ast)
        XCTAssertEqual(parsed.logic, .conjunction)
        XCTAssertEqual(parsed.children.count, 2)

        let left = try clause(parsed.children[0])
        XCTAssertEqual(left.field, "done")
        XCTAssertEqual(left.comparison, .equal)
        XCTAssertEqual(left.value, .boolean(false))

        let right = try clause(parsed.children[1])
        XCTAssertEqual(right.field, "priority")
        XCTAssertEqual(right.comparison, .greaterOrEqual)
        XCTAssertEqual(right.value, .number(3))
    }

    func testArrayCollectionIntersection() throws {
        let parsed = try clause(try parse("assignees in user1, user2").ast)
        XCTAssertEqual(parsed.field, "assignees")
        XCTAssertEqual(parsed.comparison, .inList)
        XCTAssertEqual(parsed.value, .array([.string("user1"), .string("user2")]))
    }

    func testNestedLogicPrecedence() throws {
        let parsed = try group(try parse("(priority = 1 || priority = 2) && dueDate <= now").ast)
        XCTAssertEqual(parsed.logic, .conjunction)
        XCTAssertEqual(parsed.children.count, 2)

        let orGroup = try group(parsed.children[0])
        XCTAssertEqual(orGroup.logic, .disjunction)
        XCTAssertEqual(orGroup.children.count, 2)
        let first = try clause(orGroup.children[0])
        XCTAssertEqual(first.field, "priority")
        XCTAssertEqual(first.comparison, .equal)
        XCTAssertEqual(first.value, .number(1))
        let second = try clause(orGroup.children[1])
        XCTAssertEqual(second.field, "priority")
        XCTAssertEqual(second.comparison, .equal)
        XCTAssertEqual(second.value, .number(2))

        let right = try clause(parsed.children[1])
        XCTAssertEqual(right.field, "dueDate")
        XCTAssertEqual(right.comparison, .lessOrEqual)
        XCTAssertEqual(right.value, .dateMath(value: "now", resolved: QueryDates.isoString(now)))
    }

    func testNotEqualOperator() throws {
        let parsed = try clause(try parse("done != true").ast)
        XCTAssertEqual(parsed.field, "done")
        XCTAssertEqual(parsed.comparison, .notEqual)
        XCTAssertEqual(parsed.value, .boolean(true))
    }

    func testGreaterThanOperator() throws {
        let parsed = try clause(try parse("priority > 2").ast)
        XCTAssertEqual(parsed.comparison, .greater)
        XCTAssertEqual(parsed.value, .number(2))
    }

    func testLessOrEqualOperator() throws {
        let parsed = try clause(try parse("percentDone <= 50").ast)
        XCTAssertEqual(parsed.comparison, .lessOrEqual)
        XCTAssertEqual(parsed.value, .number(50))
    }

    func testLikeOperator() throws {
        let parsed = try clause(try parse("title like %meeting%").ast)
        XCTAssertEqual(parsed.comparison, .like)
        XCTAssertEqual(parsed.value, .string("%meeting%"))
    }

    func testNotInOperator() throws {
        let parsed = try clause(try parse("labels not in urgent, backlog").ast)
        XCTAssertEqual(parsed.field, "labels")
        XCTAssertEqual(parsed.comparison, .notInList)
        XCTAssertEqual(parsed.value, .array([.string("urgent"), .string("backlog")]))
    }

    func testOrBindsLooserThanAnd() throws {
        let parsed = try group(try parse("priority = 1 || priority = 2 && dueDate < now").ast)
        XCTAssertEqual(parsed.logic, .disjunction)
        XCTAssertEqual(parsed.children.count, 2)
        _ = try clause(parsed.children[0])
        XCTAssertEqual(try group(parsed.children[1]).logic, .conjunction)
    }

    func testQuotedStringsAndDecimals() throws {
        XCTAssertEqual(try clause(try parse("project = 'My \\'Home\\''").ast).value, .string("My 'Home'"))
        XCTAssertEqual(try clause(try parse("percentDone = 0.5").ast).value, .number(0.5))
        XCTAssertEqual(try clause(try parse("percentDone = .5").ast).value, .number(0.5))
    }

    func testSyntaxErrorsThrow() {
        XCTAssertThrowsError(try parse("priority ="))
        XCTAssertThrowsError(try parse("priority 4"))
        XCTAssertThrowsError(try parse("(priority = 1"))
        XCTAssertThrowsError(try parse("priority = 1 @")) { error in
            XCTAssertEqual((error as? FilterParseError)?.message, "Unexpected character '@' at position 13")
        }
    }
}
