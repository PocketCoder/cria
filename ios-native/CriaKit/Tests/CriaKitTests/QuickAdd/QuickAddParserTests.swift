import XCTest
@testable import CriaKit

final class QuickAddParserTests: XCTestCase {
    func testPlainTitle() {
        let result = parse("Buy milk")
        XCTAssertEqual(result.title, "Buy milk")
        XCTAssertTrue(nothingParsed(result))
    }

    func testLabelToken() {
        let result = parse("Buy milk *shopping")
        XCTAssertEqual(result.title, "Buy milk")
        XCTAssertEqual(result.labelTitles, ["shopping"])
    }

    func testQuotedMultiWordLabel() {
        let result = parse("Plan trip *\"south africa\" tomorrow")
        XCTAssertEqual(result.title, "Plan trip")
        XCTAssertEqual(result.labelTitles, ["south africa"])
        XCTAssertNotNil(result.dueDate)
    }

    func testMultipleLabelsAccumulate() {
        let result = parse("*a Bake bread *b")
        XCTAssertEqual(result.title, "Bake bread")
        XCTAssertEqual(result.labelTitles, ["a", "b"])
    }

    func testPriorityTakesHighest() {
        let result = parse("Hotfix !2 something !4")
        XCTAssertEqual(result.title, "Hotfix something")
        XCTAssertEqual(result.priority, 4)
    }

    func testOutOfRangePriorityStaysInTitle() {
        let result = parse("Triage !9")
        XCTAssertEqual(result.title, "Triage !9")
        XCTAssertNil(result.priority)
    }

    func testAssigneeToken() {
        let result = parse("Review PR @alice")
        XCTAssertEqual(result.title, "Review PR")
        XCTAssertEqual(result.assigneeUsernames, ["alice"])
    }

    func testProjectToken() {
        let result = parse("Fix bugs +Personal")
        XCTAssertEqual(result.title, "Fix bugs")
        XCTAssertEqual(result.projectTitle, "Personal")
    }

    func testQuotedMultiWordProject() {
        let result = parse("Plan trip +\"Work Projects\" tomorrow")
        XCTAssertEqual(result.title, "Plan trip")
        XCTAssertEqual(result.projectTitle, "Work Projects")
        XCTAssertNotNil(result.dueDate)
    }

    func testSmartQuotes() {
        let result = parse("hello +\u{201C}Hello you\u{201D} *\u{201C}two words\u{201D}")
        XCTAssertEqual(result.title, "hello")
        XCTAssertEqual(result.projectTitle, "Hello you")
        XCTAssertEqual(result.labelTitles, ["two words"])
    }

    func testUnterminatedQuotedLabelPreviews() {
        let result = parse("*\"hello you")
        XCTAssertEqual(result.title, "")
        XCTAssertEqual(result.labelTitles, ["hello you"])
    }

    func testUnterminatedQuotedProjectPreviews() {
        let result = parse("Plan trip +\u{201C}Work St")
        XCTAssertEqual(result.title, "Plan trip")
        XCTAssertEqual(result.projectTitle, "Work St")
    }

    func testEmptyOpenQuoteDoesNotChip() {
        let result = parse("todo *\"")
        XCTAssertEqual(result.labelTitles, [])
        XCTAssertEqual(result.title, "todo *\"")
    }

    func testLastProjectWins() {
        let result = parse("+Dev Write tests +Personal")
        XCTAssertEqual(result.title, "Write tests")
        XCTAssertEqual(result.projectTitle, "Personal")
    }

    func testDatePhraseIsRemovedFromTitle() {
        let result = parse("Submit invoice next friday")
        XCTAssertEqual(result.title.lowercased(), "submit invoice")
        // Friday after Wed 2026-05-27 is 2026-05-29.
        XCTAssertEqual(utcParts(result.dueDate)?.weekday, 6)
        XCTAssertEqual(utcParts(result.dueDate)?.day, 29)
    }

    func testFirstDateWins() {
        let result = parse("Workshop tomorrow then again next week")
        XCTAssertEqual(utcParts(result.dueDate)?.day, 28)
    }

    func testEverythingInOneGo() {
        let result = parse("Buy milk tomorrow *shopping !2 @alice +Personal")
        XCTAssertEqual(result.title, "Buy milk")
        XCTAssertNotNil(result.dueDate)
        XCTAssertEqual(result.priority, 2)
        XCTAssertEqual(result.labelTitles, ["shopping"])
        XCTAssertEqual(result.assigneeUsernames, ["alice"])
        XCTAssertEqual(result.projectTitle, "Personal")
    }

    func testStraySymbolsStayInTitle() {
        let result = parse("email@home.com loves u+2764 and C#")
        XCTAssertTrue(nothingParsed(result))
        XCTAssertEqual(result.title, "email@home.com loves u+2764 and C#")
    }

    func testTokensInterleaveForPreview() {
        let kinds = parse("Ship *v2 tomorrow @bob").tokens.map(\.kind)
        XCTAssertTrue(kinds.contains(.text))
        XCTAssertTrue(kinds.contains(.label("v2")))
        XCTAssertTrue(kinds.contains { if case .date = $0 { return true } else { return false } })
        XCTAssertTrue(kinds.contains(.assignee("bob")))
    }

    func testTokenOffsetsCoverTheInput() {
        let input = "Ship *v2 tomorrow @bob"
        let tokens = parse(input).tokens
        XCTAssertEqual(tokens.first?.start, 0)
        XCTAssertEqual(tokens.last?.end, input.utf16.count)
        XCTAssertEqual(tokens.map(\.text).joined(), input)
    }
}

final class QuickAddDateTests: XCTestCase {
    func testBareDateIsAllDayUTCMidnight() {
        let result = parse("Pay rent tomorrow")
        XCTAssertEqual(result.title, "Pay rent")
        XCTAssertEqual(result.dueDate, "2026-05-28T00:00:00Z")
    }

    func testExplicitTimeIsKept() {
        let result = parse("Call mum tomorrow at 5pm")
        XCTAssertEqual(result.title, "Call mum")
        let parts = utcParts(result.dueDate)
        XCTAssertEqual(parts?.hour, 17)
        XCTAssertEqual(parts?.day, 28)
    }

    func testTimeFormats() {
        XCTAssertEqual(utcParts(parse("Gym tomorrow 17:30").dueDate)?.minute, 30)
        XCTAssertEqual(utcParts(parse("Gym tomorrow 6am").dueDate)?.hour, 6)
        XCTAssertEqual(utcParts(parse("Gym tomorrow 12am").dueDate)?.hour, 0)
        XCTAssertEqual(utcParts(parse("Gym tomorrow 12pm").dueDate)?.hour, 12)
    }

    func testBareNumberAfterDateStaysInTitle() {
        let result = parse("Buy tomorrow 5 apples")
        XCTAssertEqual(result.title, "Buy 5 apples")
        XCTAssertEqual(result.dueDate, "2026-05-28T00:00:00Z")
    }

    func testStandaloneTimeRollsToTomorrowWhenPast() {
        XCTAssertEqual(utcParts(parse("Stand up at 9am").dueDate)?.day, 28)
        XCTAssertEqual(utcParts(parse("Stand up at 5pm").dueDate)?.day, 27)
    }

    func testISODate() {
        XCTAssertEqual(parse("File taxes 2026-07-04").dueDate, "2026-07-04T00:00:00Z")
    }

    func testMonthDayPhrases() {
        XCTAssertEqual(parse("Party June 3rd").dueDate, "2026-06-03T00:00:00Z")
        XCTAssertEqual(parse("Party 3 june 2027").dueDate, "2027-06-03T00:00:00Z")
        // Already past this year, so it rolls to the next one.
        XCTAssertEqual(parse("Anniversary 2 March").dueDate, "2027-03-02T00:00:00Z")
    }

    func testRelativePhrases() {
        XCTAssertEqual(parse("Follow up in 3 days").dueDate, "2026-05-30T00:00:00Z")
        XCTAssertEqual(parse("Follow up in 2 weeks").dueDate, "2026-06-10T00:00:00Z")
        XCTAssertEqual(parse("Review next week").dueDate, "2026-06-03T00:00:00Z")
        XCTAssertEqual(utcParts(parse("Check in 2 hours").dueDate)?.hour, 12)
    }

    func testWeekdayRules() {
        XCTAssertEqual(utcParts(parse("Sync friday").dueDate)?.day, 29)
        XCTAssertEqual(utcParts(parse("Sync wednesday").dueDate)?.day, 27)
        XCTAssertEqual(utcParts(parse("Sync next wednesday").dueDate)?.day, 3)
    }

    func testInvalidDatesAreIgnored() {
        XCTAssertNil(parse("Pay 31 feb").dueDate)
        XCTAssertNil(parse("Meet at 25:00").dueDate)
    }
}

final class QuickAddRecurrenceTests: XCTestCase {
    private func repeats(_ line: String) -> (after: Int?, mode: Int?) {
        let result = parse(line)
        return (result.repeatAfter, result.repeatMode)
    }

    func testEveryDayAndDaily() {
        XCTAssertEqual(parse("Water plants every day").title, "Water plants")
        XCTAssertEqual(repeats("Water plants every day").after, 86_400)
        XCTAssertEqual(repeats("Water plants every day").mode, 0)
        XCTAssertEqual(parse("Water routine daily").title, "Water routine")
        XCTAssertEqual(repeats("Water routine daily").after, 86_400)
    }

    func testEveryNDays() {
        XCTAssertEqual(parse("Take meds every 3 days").title, "Take meds")
        XCTAssertEqual(repeats("Take meds every 3 days").after, 259_200)
        XCTAssertEqual(repeats("Take meds every 3 days").mode, 0)
    }

    func testWeekly() {
        XCTAssertEqual(repeats("Team standup weekly").after, 604_800)
        XCTAssertEqual(repeats("Review every week").after, 604_800)
        XCTAssertEqual(repeats("Review every week").mode, 0)
    }

    func testMonthlyUsesRepeatMode() {
        XCTAssertNil(repeats("Pay rent monthly").after)
        XCTAssertEqual(repeats("Pay rent monthly").mode, 1)
        XCTAssertNil(repeats("Check in every month").after)
        XCTAssertEqual(repeats("Check in every month").mode, 1)
        XCTAssertNil(repeats("Pay rent every 1 month").after)
        XCTAssertEqual(repeats("Pay rent every 1 month").mode, 1)
    }

    func testEveryNMonthsIsApproximated() {
        XCTAssertEqual(repeats("Dentist every 3 months").after, 3 * 2_592_000)
        XCTAssertEqual(repeats("Dentist every 3 months").mode, 0)
        XCTAssertEqual(parse("Dentist every 3 months").title, "Dentist")
    }

    func testEveryWeekdayIsWeekly() {
        XCTAssertEqual(parse("Prep meals every monday").title, "Prep meals")
        XCTAssertEqual(repeats("Prep meals every monday").after, 604_800)
        XCTAssertNil(parse("Prep meals every monday").dueDate)
    }

    func testRecurrenceAndDateTogether() {
        let result = parse("Submit report tomorrow monthly")
        XCTAssertEqual(result.title, "Submit report")
        XCTAssertNotNil(result.dueDate)
        XCTAssertEqual(result.repeatMode, 1)
    }

    func testRecurrenceTokenForPreview() {
        let token = parse("Gym daily").tokens.first {
            if case .recurrence = $0.kind { return true } else { return false }
        }
        XCTAssertEqual(token?.kind, .recurrence(repeatAfter: 86_400, repeatMode: 0))
    }

    func testUnparseableEveryStaysInTitle() {
        let result = parse("Review every detail")
        XCTAssertNil(result.repeatAfter)
        XCTAssertNil(result.repeatMode)
        XCTAssertEqual(result.title, "Review every detail")
    }
}

final class QuickAddNeedsQuotingTests: XCTestCase {
    func testFlagsNamesOutsideTheBareClass() {
        for name in ["Work", "a_b-c", "Q4"] { XCTAssertFalse(quickAddNeedsQuoting(name)) }
        for name in ["Caf\u{E9}", "Mum's", "Home Admin", "Na\u{EF}ve", ""] { XCTAssertTrue(quickAddNeedsQuoting(name)) }
    }

    func testMatchesTheParser() {
        XCTAssertNil(parse("Buy bread +Caf\u{E9}").projectTitle)
        XCTAssertEqual(parse("Buy bread +\"Caf\u{E9}\"").projectTitle, "Caf\u{E9}")
        let result = parse("Call mum +\"Mum's\" *\"Mum's list\"")
        XCTAssertEqual(result.projectTitle, "Mum's")
        XCTAssertEqual(result.labelTitles, ["Mum's list"])
        XCTAssertEqual(result.title, "Call mum")
    }
}

final class QuickAddModeTests: XCTestCase {
    func testPrefixTable() {
        XCTAssertNil(QuickAddMagicMode.disabled.prefixes)
        XCTAssertEqual(QuickAddMagicMode.vikunja.prefixes, QuickAddPrefixes(label: "*", project: "+", assignee: "@", priority: "!"))
        XCTAssertEqual(QuickAddMagicMode.todoist.prefixes, QuickAddPrefixes(label: "@", project: "#", assignee: "+", priority: "!"))
        XCTAssertEqual(QuickAddMagicMode.default, .vikunja)
    }

    func testKnownModeStringsOnly() {
        for mode in QuickAddMagicMode.allCases { XCTAssertEqual(QuickAddMagicMode(rawValue: mode.rawValue), mode) }
        for value in ["Vikunja", "default", ""] { XCTAssertNil(QuickAddMagicMode(rawValue: value)) }
    }

    func testDefaultsToVikunjaPrefixes() {
        let line = "Buy milk *shopping !2 @alice +Personal"
        XCTAssertEqual(parse(line, mode: .vikunja), parse(line))
    }

    func testTodoistPrefixes() {
        let result = parse("Buy milk tomorrow @shopping !2 +alice #Personal", mode: .todoist)
        XCTAssertEqual(result.title, "Buy milk")
        XCTAssertEqual(result.labelTitles, ["shopping"])
        XCTAssertEqual(result.projectTitle, "Personal")
        XCTAssertEqual(result.assigneeUsernames, ["alice"])
        XCTAssertEqual(result.priority, 2)
        XCTAssertNotNil(result.dueDate)
    }

    func testTodoistQuotedAndUnterminated() {
        let result = parse("Plan trip @\"south africa\" #\u{201C}Work Projects\u{201D}", mode: .todoist)
        XCTAssertEqual(result.title, "Plan trip")
        XCTAssertEqual(result.labelTitles, ["south africa"])
        XCTAssertEqual(result.projectTitle, "Work Projects")
        XCTAssertEqual(parse("Plan trip @\"two wo", mode: .todoist).labelTitles, ["two wo"])
        XCTAssertEqual(parse("Plan trip #\"Work St", mode: .todoist).projectTitle, "Work St")
    }

    func testTodoistLeavesVikunjaSymbolsAndInWordSymbols() {
        XCTAssertEqual(parse("Fix *bug", mode: .todoist).title, "Fix *bug")
        let result = parse("Learn C# and email me@home.com", mode: .todoist)
        XCTAssertEqual(result.title, "Learn C# and email me@home.com")
        XCTAssertNil(result.projectTitle)
        XCTAssertEqual(result.labelTitles, [])
    }

    func testTodoistPreviewTokenKinds() {
        let tokens = parse("Ship @v2 +bob #Dev", mode: .todoist).tokens.filter { $0.kind != .text }
        XCTAssertEqual(tokens.map(\.kind), [.label("v2"), .assignee("bob"), .project("Dev")])
        XCTAssertEqual(tokens.map(\.text), ["@v2", "+bob", "#Dev"])
    }

    func testDisabledKeepsWholeInput() {
        let line = "Buy milk tomorrow *shopping !2 @alice +Personal every day"
        let result = parse(line, mode: .disabled)
        XCTAssertEqual(result.title, line)
        XCTAssertTrue(nothingParsed(result))
    }

    func testDisabledKeepsInnerSpacingAndOneTextToken() {
        let result = parse("  Call  mum ", mode: .disabled)
        XCTAssertEqual(result.title, "Call  mum")
        XCTAssertEqual(result.tokens, [QuickAddToken(kind: .text, start: 0, end: 12, text: "  Call  mum ")])
        XCTAssertEqual(parse("", mode: .disabled).tokens, [])
    }
}
