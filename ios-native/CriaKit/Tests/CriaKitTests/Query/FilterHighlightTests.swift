import XCTest
@testable import CriaKit

final class FilterHighlightTests: XCTestCase {
    private struct Piece: Equatable {
        let text: String
        let kind: HighlightKind
    }

    private func pieces(_ query: String) -> [Piece] {
        let chars = Array(query)
        return highlightSpans(query).map { Piece(text: String(chars[$0.start..<$0.end]), kind: $0.kind) }
    }

    func testClassifiesFieldsOperatorsValuesAndLogicalJoins() {
        XCTAssertEqual(pieces("done = false && priority >= 3"), [
            Piece(text: "done", kind: .field), Piece(text: "=", kind: .operator), Piece(text: "false", kind: .value),
            Piece(text: "&&", kind: .logical), Piece(text: "priority", kind: .field),
            Piece(text: ">=", kind: .operator), Piece(text: "3", kind: .value)
        ])
    }

    func testClassifiesStringsDateMathParensAndInLists() {
        XCTAssertEqual(pieces("(dueDate < now || labels in 'urgent', 'soon')"), [
            Piece(text: "(", kind: .paren), Piece(text: "dueDate", kind: .field), Piece(text: "<", kind: .operator),
            Piece(text: "now", kind: .value), Piece(text: "||", kind: .logical), Piece(text: "labels", kind: .field),
            Piece(text: "in", kind: .operator), Piece(text: "'urgent'", kind: .value), Piece(text: ",", kind: .paren),
            Piece(text: "'soon'", kind: .value), Piece(text: ")", kind: .paren)
        ])
    }

    func testUnknownIdentifierInFieldPosition() {
        XCTAssertEqual(pieces("bogus = 1").first, Piece(text: "bogus", kind: .unknown))
    }

    func testPartialInputNeverCrashes() {
        XCTAssertEqual(pieces("labels in '").last, Piece(text: "'", kind: .value))
        XCTAssertEqual(pieces("done =").last, Piece(text: "=", kind: .operator))
        XCTAssertEqual(pieces("").count, 0)
    }

    func testSpansAreContiguousOrderedAndInRange() {
        let query = "done = false && (priority >= 3 || labels in 'a', b) ?"
        var last = 0
        for span in highlightSpans(query) {
            XCTAssertGreaterThanOrEqual(span.start, last)
            XCTAssertGreaterThan(span.end, span.start)
            last = span.end
        }
        XCTAssertLessThanOrEqual(last, query.count)
        XCTAssertEqual(pieces("?").first?.kind, .unknown)
    }
}

final class AutocompleteContextTests: XCTestCase {
    func testFieldsAtStartAndAfterLogicalOperators() {
        XCTAssertEqual(autocompleteContext("", cursor: 0), AutocompleteContext(kind: .field, prefix: "", replaceStart: 0))
        XCTAssertEqual(autocompleteContext("pri", cursor: 3), AutocompleteContext(kind: .field, prefix: "pri", replaceStart: 0))
        XCTAssertEqual(
            autocompleteContext("done = false && du", cursor: 18),
            AutocompleteContext(kind: .field, prefix: "du", replaceStart: 16)
        )
    }

    func testLabelValuesAfterLabelsOperators() {
        XCTAssertEqual(
            autocompleteContext("labels in ur", cursor: 12), AutocompleteContext(kind: .label, prefix: "ur", replaceStart: 10)
        )
        XCTAssertEqual(
            autocompleteContext("labels = 'ur", cursor: 12), AutocompleteContext(kind: .label, prefix: "ur", replaceStart: 9)
        )
    }

    func testProjectsAndAssignees() {
        XCTAssertEqual(
            autocompleteContext("project = Wo", cursor: 12), AutocompleteContext(kind: .project, prefix: "Wo", replaceStart: 10)
        )
        XCTAssertEqual(
            autocompleteContext("assignees in al", cursor: 15), AutocompleteContext(kind: .assignee, prefix: "al", replaceStart: 13)
        )
    }

    func testNilForNonEntityFields() {
        XCTAssertNil(autocompleteContext("priority = 3", cursor: 12))
        XCTAssertNil(autocompleteContext("done = fa", cursor: 9))
    }
}
