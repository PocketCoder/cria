import XCTest
@testable import CriaKit

final class SlashMenuTests: XCTestCase {
    func testSlashAtStartOrAfterWhitespaceOpensTheMenu() {
        XCTAssertEqual(SlashMenu.match(textBeforeCaret: "/"), SlashMatch(query: "", length: 1))
        XCTAssertEqual(SlashMenu.match(textBeforeCaret: "/head"), SlashMatch(query: "head", length: 5))
        XCTAssertEqual(SlashMenu.match(textBeforeCaret: "some text /h2"), SlashMatch(query: "h2", length: 3))
        XCTAssertEqual(SlashMenu.match(textBeforeCaret: "tab\t/"), SlashMatch(query: "", length: 1))
    }

    func testSlashInsideAWordOrAfterAFinishedQueryDoesNotMatch() {
        XCTAssertNil(SlashMenu.match(textBeforeCaret: "and/or"))
        XCTAssertNil(SlashMenu.match(textBeforeCaret: "https://example.com/path"))
        XCTAssertNil(SlashMenu.match(textBeforeCaret: "/head "))
        XCTAssertNil(SlashMenu.match(textBeforeCaret: "/a-b"))
        XCTAssertNil(SlashMenu.match(textBeforeCaret: ""))
        XCTAssertNil(SlashMenu.match(textBeforeCaret: "plain"))
    }

    func testLengthCountsUTF16ForTheDeletion() {
        XCTAssertEqual(SlashMenu.match(textBeforeCaret: "x /caf\u{E9}")?.length, 5)
    }

    func testFilterMatchesKeyAndTitleIgnoringCase() {
        XCTAssertEqual(SlashMenu.filter("").count, SlashCommand.allCases.count)
        XCTAssertEqual(SlashMenu.filter("h1"), [.heading1])
        XCTAssertEqual(SlashMenu.filter("HEADING"), [.heading1, .heading2, .heading3])
        // "strikethrough" contains "hr" too, as in the Tauri filter.
        XCTAssertEqual(SlashMenu.filter("hr"), [.divider, .strikethrough])
        XCTAssertTrue(SlashMenu.filter("list").contains(.taskList))
        XCTAssertTrue(SlashMenu.filter("nothing like this").isEmpty)
    }

    func testStepWrapsBothWays() {
        XCTAssertEqual(SlashMenu.step(0, count: 3, by: -1), 2)
        XCTAssertEqual(SlashMenu.step(2, count: 3, by: 1), 0)
        XCTAssertEqual(SlashMenu.step(1, count: 3, by: 1), 2)
        XCTAssertEqual(SlashMenu.step(0, count: 0, by: 1), 0)
    }

    func testOnlyEscapeIsTakenWhenNothingMatches() {
        XCTAssertTrue(SlashMenu.takes(.execute, count: 2))
        XCTAssertFalse(SlashMenu.takes(.execute, count: 0))
        XCTAssertFalse(SlashMenu.takes(.next, count: 0))
        XCTAssertTrue(SlashMenu.takes(.close, count: 0))
    }

    func testEveryCommandHasUniqueKeyAndText() {
        let keys = SlashCommand.allCases.map(\.key)
        XCTAssertEqual(Set(keys).count, keys.count)
        for command in SlashCommand.allCases {
            XCTAssertFalse(command.title.isEmpty)
            XCTAssertFalse(command.summary.isEmpty)
            XCTAssertFalse(command.symbol.isEmpty)
        }
    }
}
