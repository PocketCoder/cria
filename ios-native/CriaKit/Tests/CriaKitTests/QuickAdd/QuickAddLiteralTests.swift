import XCTest
@testable import CriaKit

final class QuickAddLiteralTests: XCTestCase {
    func testDoubleAndSingleQuotesSkipParsing() {
        let double = parse("\"delete mails up to january 30th\"")
        XCTAssertEqual(double.title, "delete mails up to january 30th")
        XCTAssertTrue(nothingParsed(double))
        let single = parse("'buy mass tomorrow *label !2 @user'")
        XCTAssertEqual(single.title, "buy mass tomorrow *label !2 @user")
        XCTAssertTrue(nothingParsed(single))
    }

    func testCurlyPairs() {
        XCTAssertEqual(parse("\u{201C}buy mass tomorrow *label !2\u{201D}").title, "buy mass tomorrow *label !2")
        XCTAssertEqual(parse("\u{2018}buy mass tomorrow\u{2019}").title, "buy mass tomorrow")
        XCTAssertNotNil(parse("\u{201C}delete mails today\"").dueDate)
    }

    func testUnmatchedAndMismatchedQuotesParseAsUsual() {
        XCTAssertNotNil(parse("\"delete mails today").dueDate)
        XCTAssertNotNil(parse("\"delete mails today'").dueDate)
        XCTAssertNotNil(parse("delete \"mails\" today").dueDate)
    }

    func testEmptyPairAndLoneQuote() {
        XCTAssertEqual(parse("\"\"").title, "")
        XCTAssertNil(parse("\"\"").dueDate)
        XCTAssertEqual(parse("\"").title, "\"")
    }

    func testEveryModeDropsThePair() {
        let inner = "Buy milk tomorrow *shop @alice +Home #Work !2 every day"
        for mode in QuickAddMagicMode.allCases {
            XCTAssertEqual(parse("\"\(inner)\"", mode: mode).title, inner)
            XCTAssertTrue(nothingParsed(parse("'\(inner)'", mode: mode)))
            XCTAssertEqual(parse("''", mode: mode).title, "")
        }
    }

    func testDisabledKeepsUnwrappedQuotes() {
        XCTAssertEqual(parse("\"Lorem ipsum", mode: .disabled).title, "\"Lorem ipsum")
        XCTAssertEqual(parse("\"Lorem ipsum'", mode: .disabled).title, "\"Lorem ipsum'")
    }

    func testOnlyEndsAreChecked() {
        let first = parse("\"Read \"Dune\" tomorrow\"")
        XCTAssertEqual(first.title, "Read \"Dune\" tomorrow")
        XCTAssertNil(first.dueDate)
        let second = parse("\"Plan\" *trip \"now\"")
        XCTAssertEqual(second.title, "Plan\" *trip \"now")
        XCTAssertEqual(second.labelTitles, [])
    }

    func testSurroundingWhitespaceIgnoredAndOneTextToken() {
        let raw = "  \" Call  mum tomorrow \" "
        let result = parse(raw)
        XCTAssertEqual(result.title, "Call  mum tomorrow")
        XCTAssertNil(result.dueDate)
        XCTAssertEqual(result.tokens, [QuickAddToken(kind: .text, start: 0, end: raw.utf16.count, text: raw)])
    }
}

final class QuickAddTaskParseTests: XCTestCase {
    func testWholeTitleMagicStaysLiteral() {
        let label = parseTask("*Urgent")
        XCTAssertEqual(label.title, "*Urgent")
        XCTAssertTrue(nothingParsed(label))
        XCTAssertEqual(parseTask("+Other").title, "+Other")
        XCTAssertTrue(nothingParsed(parseTask("+Other")))
    }

    func testKeepsTrimmedRawInputWhenNoTextParses() {
        let raw = " *label "
        let result = parseTask(raw)
        XCTAssertEqual(result.title, "*label")
        XCTAssertTrue(nothingParsed(result))
        XCTAssertEqual(result.tokens, [QuickAddToken(kind: .text, start: 0, end: raw.utf16.count, text: raw)])
    }

    func testLoneDateRepeatOrPriorityStaysText() {
        for line in ["tomorrow", "every day", "!3"] {
            XCTAssertEqual(parseTask(line).title, line)
            XCTAssertTrue(nothingParsed(parseTask(line)))
        }
    }

    func testLineOfOnlyTokensStaysAsTypedInEveryMode() {
        let cases: [(QuickAddMagicMode, String)] = [
            (.vikunja, "*errands +Home @alice !3 tomorrow every day"),
            (.todoist, "@errands #Home +alice !3 tomorrow every day"),
            (.disabled, "*errands +Home @alice !3 tomorrow every day")
        ]
        for (mode, line) in cases {
            XCTAssertEqual(parseTask(line, mode: mode).title, line)
            XCTAssertTrue(nothingParsed(parseTask(line, mode: mode)))
        }
    }

    func testEmptyQuotedPairStaysAsTyped() {
        for mode in QuickAddMagicMode.allCases {
            XCTAssertEqual(parseTask("\"\"", mode: mode).title, "\"\"")
            XCTAssertEqual(parseTask("''", mode: mode).title, "''")
        }
        XCTAssertEqual(parseTask("\"  \"").title, "\"  \"")
    }

    func testMatchesParseWhenThereIsATitle() {
        for line in ["Buy milk *shop +Home tomorrow !2", "\"*shop\"", "Buy milk"] {
            XCTAssertEqual(parseTask(line), parse(line))
        }
        XCTAssertEqual(parseTask("Buy milk @shop #Home", mode: .todoist), parse("Buy milk @shop #Home", mode: .todoist))
    }

    func testBlankInputHasNoTitle() {
        XCTAssertEqual(parseTask("").title, "")
        XCTAssertEqual(parseTask("").tokens, [])
        XCTAssertEqual(parseTask("   ").title, "")
    }
}
