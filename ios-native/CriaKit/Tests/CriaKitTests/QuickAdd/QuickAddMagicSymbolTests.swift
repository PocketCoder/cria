import XCTest
@testable import CriaKit

// Ported from Vikunja-web's `quickAddMagic.test.ts` (modes, labels, projects, priorities, assignees, repeats). The
// title comes back with its whitespace collapsed, so upstream's "Lorem Ipsum  +user" reads "Lorem Ipsum +user" here.

final class QuickAddMagicModeTests: XCTestCase {
    func testNoMagicLeavesTheTextAlone() {
        XCTAssertEqual(magic("Lorem Ipsum").title, "Lorem Ipsum")
    }

    func testDisabledParsesNothing() {
        let text = "Lorem Ipsum today *label +project !2 @user"
        let result = magic(text, mode: .disabled)
        XCTAssertEqual(result.title, text)
        XCTAssertTrue(nothingParsed(result))
    }

    func testTodoistMode() {
        let result = magic("Lorem Ipsum today @label #project !2 +user", mode: .todoist)
        XCTAssertEqual(result.title, "Lorem Ipsum +user")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-24")
        XCTAssertEqual(result.labelTitles, ["label"])
        XCTAssertEqual(result.projectTitle, "project")
        XCTAssertEqual(result.priority, 2)
        XCTAssertEqual(result.assigneeUsernames, ["user"])
    }

    func testVikunjaSymbolsMeanNothingInTodoistMode() {
        let result = magic("Lorem *label +project", mode: .todoist)
        XCTAssertEqual(result.title, "Lorem *label +project")
        XCTAssertTrue(result.labelTitles.isEmpty)
        XCTAssertEqual(result.assigneeUsernames, ["project"])
    }

    func testEmailAddressesAreIgnored() {
        let text = "Lorem Ipsum email@example.com"
        let result = magic(text)
        XCTAssertEqual(result.title, text)
        XCTAssertTrue(result.assigneeUsernames.isEmpty)
    }

    func testQuoteEscapedTextSkipsAllParsing() {
        for (text, title) in [("\"delete mails up to january 30th\"", "delete mails up to january 30th"),
                              ("'buy mass tomorrow *label !2 @user'", "buy mass tomorrow *label !2 @user")] {
            let result = magic(text)
            XCTAssertEqual(result.title, title)
            XCTAssertTrue(nothingParsed(result))
        }
        XCTAssertTrue(nothingParsed(magic("\"task today @label #project\"", mode: .todoist)))
    }

    func testUnmatchedMismatchedAndInnerQuotesStillParse() {
        for text in ["\"delete mails today", "\"delete mails today'", "delete \"mails\" today"] {
            XCTAssertNotNil(magic(text).dueDate, text)
        }
    }
}

final class QuickAddMagicLabelTests: XCTestCase {
    func testLabelsAnywhere() {
        let result = magic("Lorem Ipsum *label1 *label2")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(result.labelTitles, ["label1", "label2"])
        let start = magic("*label1 Lorem Ipsum *label2")
        XCTAssertEqual(start.title, "Lorem Ipsum")
        XCTAssertEqual(start.labelTitles, ["label1", "label2"])
    }

    func testDuplicateLabelsCountOnce() {
        let result = magic("Lorem Ipsum *label1 *label1 *label2")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(result.labelTitles, ["label1", "label2"])
    }

    func testQuotedLabelsWithSpaces() {
        for text in ["Lorem *'label with space' Ipsum", "Lorem *\"label with space\" Ipsum"] {
            let result = magic(text)
            XCTAssertEqual(result.title, "Lorem Ipsum")
            XCTAssertEqual(result.labelTitles, ["label with space"])
        }
    }

    func testLabelsNamedLikeDatesAreLabels() {
        let result = magic("Lorem Ipsum *today")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(result.labelTitles, ["today"])
        XCTAssertNil(result.dueDate)
    }

    func testLabelsWithParentheses() {
        let end = magic("a *\"a (a)\"")
        XCTAssertEqual(end.title, "a")
        XCTAssertEqual(end.labelTitles, ["a (a)"])
        let start = magic("*\"a (a)\" a")
        XCTAssertEqual(start.title, "a")
        XCTAssertEqual(start.labelTitles, ["a (a)"])
    }

    func testBareLabelsTakeAnyCharactersUpToTheSpace() {
        let result = magic("Plan *caf\u{E9} *r&d, now")
        XCTAssertEqual(result.labelTitles, ["caf\u{E9}", "r&d,"])
        XCTAssertEqual(result.title, "Plan now")
    }

    func testALabelThatStartsAnotherIsCutWhole() {
        let result = magic("Gym *work *workout")
        XCTAssertEqual(result.labelTitles, ["work", "workout"])
        XCTAssertEqual(result.title, "Gym")
    }

    func testLabelTokensCoverTheirText() {
        let tokens = magic("Lorem *label1 Ipsum").tokens
        XCTAssertEqual(tokens.map(\.text), ["Lorem ", "*label1", " Ipsum"])
        XCTAssertEqual(tokens.map(\.kind), [.text, .label("label1"), .text])
    }
}

final class QuickAddMagicProjectTests: XCTestCase {
    func testProject() {
        let result = magic("Lorem Ipsum +project")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(result.projectTitle, "project")
    }

    func testQuotedProjects() {
        for text in ["Lorem Ipsum +'project with long name'", "Lorem Ipsum +\"project with long name\""] {
            let result = magic(text)
            XCTAssertEqual(result.title, "Lorem Ipsum")
            XCTAssertEqual(result.projectTitle, "project with long name")
        }
    }

    func testOnlyTheFirstProjectIsTaken() {
        let result = magic("Lorem Ipsum +project1 +project2 +project3")
        XCTAssertEqual(result.title, "Lorem Ipsum +project2 +project3")
        XCTAssertEqual(result.projectTitle, "project1")
    }

    func testProjectNamedLikeADate() {
        let result = magic("Lorem Ipsum +today")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(result.projectTitle, "today")
        XCTAssertNil(result.dueDate)
    }

    func testAPlusWithNothingAfterItStaysText() {
        let result = magic("1 + 1")
        XCTAssertEqual(result.title, "1 + 1")
        XCTAssertNil(result.projectTitle)
    }
}

final class QuickAddMagicPriorityTests: XCTestCase {
    func testEveryVikunjaPriority() {
        for value in 0...5 {
            let result = magic("Lorem Ipsum !\(value)")
            XCTAssertEqual(result.title, "Lorem Ipsum")
            XCTAssertEqual(result.priority, value)
        }
    }

    func testInvalidPriorityStaysInTheTitle() {
        let result = magic("Lorem Ipsum !9999")
        XCTAssertEqual(result.title, "Lorem Ipsum !9999")
        XCTAssertNil(result.priority)
    }

    func testTheFirstValidPriorityWins() {
        let skipped = magic("Lorem Ipsum !9999 !1")
        XCTAssertEqual(skipped.title, "Lorem Ipsum !9999")
        XCTAssertEqual(skipped.priority, 1)
        let first = magic("Hotfix !2 something !4")
        XCTAssertEqual(first.priority, 2)
        XCTAssertEqual(first.title, "Hotfix something !4")
    }
}

final class QuickAddMagicAssigneeTests: XCTestCase {
    func testAssigneesStayInTheTitle() {
        let result = magic("Lorem Ipsum @user")
        XCTAssertEqual(result.title, "Lorem Ipsum @user")
        XCTAssertEqual(result.assigneeUsernames, ["user"])
    }

    func testSeveralAssigneesWithoutDuplicates() {
        let result = magic("Lorem Ipsum @user1 @user1 @user2 @user3")
        XCTAssertEqual(result.title, "Lorem Ipsum @user1 @user1 @user2 @user3")
        XCTAssertEqual(result.assigneeUsernames, ["user1", "user2", "user3"])
    }

    func testQuotedAssignees() {
        for text in ["Lorem Ipsum @'user with long name'", "Lorem Ipsum @\"user with long name\""] {
            let result = magic(text)
            XCTAssertEqual(result.title, text)
            XCTAssertEqual(result.assigneeUsernames, ["user with long name"])
        }
    }

    func testAssigneeNamedLikeADate() {
        let result = magic("Lorem Ipsum @today")
        XCTAssertEqual(result.title, "Lorem Ipsum @today")
        XCTAssertEqual(result.assigneeUsernames, ["today"])
        XCTAssertNil(result.dueDate)
    }

    func testAnEmailAsTheName() {
        let result = magic("Lorem Ipsum @email@example.com")
        XCTAssertEqual(result.title, "Lorem Ipsum @email@example.com")
        XCTAssertEqual(result.assigneeUsernames, ["email@example.com"])
    }

    func testAssigneeTokensShowButKeepTheirText() {
        let result = magic("Ship @bob tomorrow")
        let token = result.tokens.first { $0.kind == .assignee("bob") }
        XCTAssertEqual(token?.text, "@bob")
        XCTAssertEqual(token?.inTitle, true)
        XCTAssertEqual(result.tokens.map(\.text).joined(), "Ship @bob tomorrow")
        XCTAssertEqual(result.title, "Ship @bob")
    }
}

final class QuickAddMagicRepeatTests: XCTestCase {
    private let hour = 3_600
    private let day = 86_400
    private let week = 604_800
    private let year = 31_536_000

    /// (phrase, repeat_after, repeat_mode)
    private var cases: [(String, Int?, Int)] {
        let month: (Int?, Int) = (nil, 1)
        let thirtyDays = 2_592_000
        return [
            ("every 1 hour", hour, 0), ("every hour", hour, 0), ("every 5 hours", 5 * hour, 0), ("every 12 hours", 12 * hour, 0),
            ("every day", day, 0), ("every 1 day", day, 0), ("every 2 days", 2 * day, 0), ("every week", week, 0),
            ("every 1 week", week, 0), ("every 3 weeks", 3 * week, 0), ("every month", month.0, month.1),
            ("every 1 month", month.0, month.1), ("every 2 months", 2 * thirtyDays, 0), ("every year", year, 0),
            ("every 1 year", year, 0), ("every 4 years", 4 * year, 0), ("every one hour", hour, 0), ("every two hours", 2 * hour, 0),
            ("every three hours", 3 * hour, 0), ("every four hours", 4 * hour, 0), ("every five hours", 5 * hour, 0),
            ("every six hours", 6 * hour, 0), ("every seven hours", 7 * hour, 0), ("every eight hours", 8 * hour, 0),
            ("every nine hours", 9 * hour, 0), ("every ten hours", 10 * hour, 0), ("each week", week, 0),
            ("annually", year, 0), ("biannually", 6 * thirtyDays, 0), ("semiannually", 6 * thirtyDays, 0),
            ("biennially", 2 * year, 0), ("daily", day, 0), ("hourly", hour, 0), ("monthly", month.0, month.1),
            ("weekly", week, 0), ("yearly", year, 0), ("Daily", day, 0)
        ]
    }

    func testEveryPhrase() {
        for (phrase, after, mode) in cases {
            let result = magic("Lorem Ipsum \(phrase)")
            XCTAssertEqual(result.title, "Lorem Ipsum", phrase)
            XCTAssertEqual(result.repeatAfter, after, phrase)
            XCTAssertEqual(result.repeatMode, mode, phrase)
        }
    }

    func testEveryPhraseWithATime() {
        for (phrase, after, mode) in cases {
            let result = magic("Lorem Ipsum \(phrase) at 11:42")
            XCTAssertEqual(result.title, "Lorem Ipsum", phrase)
            XCTAssertEqual(result.repeatAfter, after, phrase)
            XCTAssertEqual(result.repeatMode, mode, phrase)
            XCTAssertEqual(stamp(result.dueDate), "2021-6-24 11:42", phrase)
        }
    }

    func testRepeatWordsInsideAWordAreText() {
        for word in ["annually", "biannually", "semiannually", "biennially", "daily", "hourly", "monthly", "weekly", "yearly"] {
            let text = "Lorem Ipsum word\(word)notword"
            let result = magic(text)
            XCTAssertEqual(result.title, text)
            XCTAssertNil(result.repeatAfter)
            XCTAssertNil(result.repeatMode)
        }
    }

    func testEveryWeekdayIsNotARepeatUpstream() {
        // Vikunja-web reads "every monday" as "every" plus the date "monday".
        let result = magic("Prep meals every monday")
        XCTAssertNil(result.repeatAfter)
        XCTAssertEqual(result.title, "Prep meals every")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-28")
    }

    func testAnAbsurdAmountIsNotARepeat() {
        let result = magic("Lorem every 99999999999999999999 days")
        XCTAssertNil(result.repeatAfter)
    }
}
