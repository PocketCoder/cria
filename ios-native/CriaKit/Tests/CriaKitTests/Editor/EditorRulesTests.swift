import XCTest
@testable import CriaKit

final class EditorRulesTests: XCTestCase {
    func testReturnContinuesListsAndRestartsTasksUnchecked() {
        XCTAssertEqual(EditorRules.returnAction(kind: .bullet, depth: 0, isEmpty: false), .continueWith(.bullet))
        XCTAssertEqual(EditorRules.returnAction(kind: .ordered, depth: 2, isEmpty: false), .continueWith(.ordered))
        XCTAssertEqual(
            EditorRules.returnAction(kind: .task(checked: true), depth: 0, isEmpty: false),
            .continueWith(.task(checked: false))
        )
    }

    func testReturnOnEmptyItemExitsOrOutdents() {
        XCTAssertEqual(EditorRules.returnAction(kind: .bullet, depth: 0, isEmpty: true), .exitToParagraph)
        XCTAssertEqual(EditorRules.returnAction(kind: .task(checked: false), depth: 1, isEmpty: true), .outdent)
        XCTAssertEqual(EditorRules.returnAction(kind: .quote, depth: 0, isEmpty: true), .exitToParagraph)
    }

    func testReturnInQuoteCodeHeadingAndParagraph() {
        XCTAssertEqual(EditorRules.returnAction(kind: .quote, depth: 0, isEmpty: false), .continueWith(.quote))
        XCTAssertEqual(EditorRules.returnAction(kind: .code, depth: 0, isEmpty: false), .lineBreak)
        XCTAssertEqual(EditorRules.returnAction(kind: .heading(2), depth: 0, isEmpty: false), .continueWith(.paragraph))
        XCTAssertEqual(EditorRules.returnAction(kind: .paragraph, depth: 0, isEmpty: true), .continueWith(.paragraph))
    }

    func testBackspaceAtParagraphStart() {
        XCTAssertEqual(EditorRules.backspaceAction(kind: .bullet, depth: 1), .outdent)
        XCTAssertEqual(EditorRules.backspaceAction(kind: .bullet, depth: 0), .toParagraph)
        XCTAssertEqual(EditorRules.backspaceAction(kind: .heading(1), depth: 0), .toParagraph)
        XCTAssertEqual(EditorRules.backspaceAction(kind: .quote, depth: 0), .toParagraph)
        XCTAssertEqual(EditorRules.backspaceAction(kind: .paragraph, depth: 0), .mergeWithPrevious)
    }

    func testToggleTurnsActiveKindBackIntoParagraph() {
        XCTAssertEqual(EditorRules.toggled(.paragraph, to: .bullet), .bullet)
        XCTAssertEqual(EditorRules.toggled(.bullet, to: .bullet), .paragraph)
        XCTAssertEqual(EditorRules.toggled(.bullet, to: .ordered), .ordered)
        XCTAssertEqual(EditorRules.toggled(.task(checked: true), to: .task(checked: false)), .paragraph)
        XCTAssertEqual(EditorRules.toggled(.heading(1), to: .heading(2)), .heading(2))
    }

    func testIndentIsClampedAndOnlyForListItems() {
        XCTAssertEqual(EditorRules.indented(depth: 0, kind: .bullet), 1)
        XCTAssertEqual(EditorRules.indented(depth: EditorRules.maxListDepth, kind: .bullet), EditorRules.maxListDepth)
        XCTAssertEqual(EditorRules.indented(depth: 0, kind: .paragraph), 0)
        XCTAssertEqual(EditorRules.outdented(depth: 0), 0)
        XCTAssertEqual(EditorRules.depth(afterChangingTo: .paragraph, from: 3), 0)
        XCTAssertEqual(EditorRules.depth(afterChangingTo: .ordered, from: 3), 3)
    }

    func testOrderedNumbersRestartAfterInterruptionsAndNesting() {
        let blocks = [
            Block(kind: .ordered),
            Block(kind: .ordered),
            Block(kind: .ordered, depth: 1),
            Block(kind: .ordered, depth: 1),
            Block(kind: .ordered),
            Block(kind: .bullet),
            Block(kind: .ordered),
            Block(kind: .paragraph),
            Block(kind: .ordered)
        ]
        XCTAssertEqual(EditorRules.listNumbers(for: blocks), [1, 2, 1, 2, 3, nil, 1, nil, 1])
    }
}
