import XCTest
@testable import CriaKit

// The expanded quick-add syntax (see QuickAddExpanded.swift). "Now" is Thursday 24 June 2021, 12:00 UTC.

private func expand(
    _ text: String, mode: QuickAddMagicMode = .vikunja, detectDates: Bool = true, defaultTime: DefaultDueTime? = nil
) -> QuickAddResult {
    parseQuickAdd(
        text, now: june24, mode: mode, calendar: utcCalendar, detectDates: detectDates, defaultDueTime: defaultTime, expanded: true
    )
}

final class QuickAddExpandedPriorityTests: XCTestCase {
    func testPWordsMapOntoVikunjasScale() {
        let expected = [("p1", 4), ("p2", 3), ("p3", 2), ("p4", 1), ("P1", 4)]
        for (word, priority) in expected {
            let result = expand("Fix the roof \(word)")
            XCTAssertEqual(result.priority, priority, word)
            XCTAssertEqual(result.title, "Fix the roof", word)
        }
        XCTAssertEqual(expand("p2 Fix the roof").title, "Fix the roof")
    }

    func testOffByDefault() {
        let result = magic("Fix the roof p1")
        XCTAssertNil(result.priority)
        XCTAssertEqual(result.title, "Fix the roof p1")
    }

    func testBangPriorityWinsAndBothAreCut() {
        let result = expand("Fix p1 the roof !2")
        XCTAssertEqual(result.priority, 2)
        XCTAssertEqual(result.title, "Fix the roof")
    }

    func testOnlyWholeWordsWithOneToFour() {
        for text in ["Buy p5 pens", "Visit hip1", "Rename p1x", "Read p12"] {
            XCTAssertNil(expand(text).priority, text)
            XCTAssertEqual(expand(text).title, text)
        }
    }

    func testPunctuationAfterThePWord() {
        let result = expand("Fix the roof, p1.")
        XCTAssertEqual(result.priority, 4)
    }

    func testWorksInTodoistModeAndNotWhenDisabled() {
        XCTAssertEqual(expand("Call Sam @phone p3", mode: .todoist).priority, 2)
        let off = expand("Call Sam p3", mode: .disabled)
        XCTAssertNil(off.priority)
        XCTAssertEqual(off.title, "Call Sam p3")
    }

    func testTokenKindCarriesTheMappedPriority() {
        let token = expand("Fix p1").tokens.first { $0.text == "p1" }
        XCTAssertEqual(token?.kind, .priority(4))
    }
}

final class QuickAddExpandedRepeatTests: XCTestCase {
    func testBangRepeatsFromCompletion() {
        let cases: [(String, Int)] = [
            ("every! day", 86_400), ("every! 3 days", 259_200), ("every! week", 604_800), ("each! two weeks", 1_209_600),
            ("every! month", 2_592_000), ("every! 2 years", 63_072_000), ("every! hour", 3_600)
        ]
        for (phrase, seconds) in cases {
            let result = expand("Water plants \(phrase)")
            XCTAssertEqual(result.title, "Water plants", phrase)
            XCTAssertEqual(result.repeatAfter, seconds, phrase)
            XCTAssertEqual(result.repeatMode, 2, phrase)
        }
    }

    func testAfterCompletionWords() {
        let cases: [(String, Int)] = [
            ("every week after completion", 604_800), ("every 2 days after done", 172_800), ("daily after completing", 86_400),
            ("monthly after completion", 2_592_000), ("every three hours after completed", 10_800)
        ]
        for (phrase, seconds) in cases {
            let result = expand("Stretch \(phrase)")
            XCTAssertEqual(result.title, "Stretch", phrase)
            XCTAssertEqual(result.repeatAfter, seconds, phrase)
            XCTAssertEqual(result.repeatMode, 2, phrase)
        }
    }

    func testPlainRepeatsAreUnchanged() {
        let result = expand("Water plants every week")
        XCTAssertEqual(result.repeatAfter, 604_800)
        XCTAssertEqual(result.repeatMode, 0)
        let monthly = expand("Pay rent monthly")
        XCTAssertNil(monthly.repeatAfter)
        XCTAssertEqual(monthly.repeatMode, 1)
    }

    func testOffByDefault() {
        let result = magic("Water plants every! day")
        XCTAssertNil(result.repeatAfter)
        XCTAssertEqual(result.title, "Water plants every! day")
        let words = magic("Stretch every week after completion")
        XCTAssertEqual(words.repeatMode, 0, "the plain repeat still reads")
        XCTAssertEqual(words.title, "Stretch after completion")
    }

    func testRepeatWithADate() {
        let result = expand("Pay rent tomorrow every! month")
        XCTAssertEqual(result.title, "Pay rent")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25")
        XCTAssertEqual(result.repeatMode, 2)
    }

    func testTokenIsARecurrence() {
        let token = expand("Stretch every! 2 days").tokens.first {
            if case .recurrence = $0.kind { return true } else { return false }
        }
        XCTAssertEqual(token?.kind, .recurrence(repeatAfter: 172_800, repeatMode: 2))
        XCTAssertEqual(token?.text, "every! 2 days")
    }
}

final class QuickAddExpandedDeadlineTests: XCTestCase {
    func testBracesHoldTheEndDate() {
        let result = expand("Pay tax {friday}")
        XCTAssertEqual(result.title, "Pay tax")
        XCTAssertEqual(stamp(result.endDate), "2021-6-25")
        XCTAssertNil(result.dueDate)
        XCTAssertEqual(stamp(expand("Pay tax {in 3 days}").endDate), "2021-6-27", "all-day, not this time of day")
        XCTAssertEqual(stamp(expand("Pay tax {tomorrow at 5pm}").endDate), "2021-6-25 17:0")
        XCTAssertEqual(stamp(expand("Pay tax {Jul 4}").endDate), "2021-7-4")
    }

    func testDeadlineAndDueDateTogether() {
        let result = expand("Write report tomorrow {next week}")
        XCTAssertEqual(result.title, "Write report")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25")
        XCTAssertEqual(stamp(result.endDate), "2021-7-1")
    }

    func testBracesWithMoreThanADateAreText() {
        for text in ["Pay {the tax friday}", "Pay {tax}", "Pay {}"] {
            let result = expand(text)
            XCTAssertNil(result.endDate, text)
            XCTAssertEqual(result.title, text)
        }
    }

    func testTheDeadlineDoesNotBecomeTheDueDate() {
        XCTAssertNil(expand("Pay tax {tomorrow}").dueDate)
    }

    func testOffByDefaultAndWithoutDateDetection() {
        let off = magic("Pay tax {friday}")
        XCTAssertNil(off.endDate)
        XCTAssertEqual(off.title, "Pay tax {friday}")
        let noDates = expand("Pay tax {friday}", detectDates: false)
        XCTAssertNil(noDates.endDate)
        XCTAssertEqual(noDates.title, "Pay tax {friday}")
    }

    func testTokenKind() {
        let token = expand("Pay tax {friday}").tokens.first {
            if case .deadline = $0.kind { return true } else { return false }
        }
        XCTAssertEqual(token?.text, "{friday}")
    }
}

final class QuickAddExpandedRangeTests: XCTestCase {
    func testRangeSetsDueStartAndEnd() {
        let result = expand("Standup tomorrow 9-10am")
        XCTAssertEqual(result.title, "Standup")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25 9:0")
        XCTAssertEqual(stamp(result.startDate), "2021-6-25 9:0")
        XCTAssertEqual(stamp(result.endDate), "2021-6-25 10:0")
    }

    func testRangesInEveryShape() {
        let cases: [(String, String, String)] = [
            ("Class 14:00-15:30", "2021-6-24 14:0", "2021-6-24 15:30"), ("Class 9am-10:30am", "2021-6-24 9:0", "2021-6-24 10:30"),
            ("Class 9:30am-11", "2021-6-24 9:30", "2021-6-24 11:0"), ("Class at 12-1pm", "2021-6-24 12:0", "2021-6-24 13:0"),
            ("Class 11-1pm", "2021-6-24 11:0", "2021-6-24 13:0"), ("Class 10-11pm", "2021-6-24 22:0", "2021-6-24 23:0"),
            ("Class 9-5pm", "2021-6-24 9:0", "2021-6-24 17:0"), ("Class @ 6-7 pm", "2021-6-24 18:0", "2021-6-24 19:0"),
            ("Class 9\u{2013}10am", "2021-6-24 9:0", "2021-6-24 10:0")
        ]
        for (text, start, end) in cases {
            let result = expand(text)
            XCTAssertEqual(result.title, "Class", text)
            XCTAssertEqual(stamp(result.startDate), start, text)
            XCTAssertEqual(stamp(result.endDate), end, text)
        }
    }

    func testRangeUsesTheLinesDate() {
        let result = expand("Workshop friday 13:00-14:00")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25 13:0")
        XCTAssertEqual(stamp(result.endDate), "2021-6-25 14:0")
        XCTAssertEqual(stamp(expand("Workshop 13:00-14:00 2 Jul").dueDate), "2021-7-2 13:0")
    }

    func testRangeBeatsAnAtTime() {
        let result = expand("Workshop tomorrow at 5pm 9-10am")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25 9:0")
        XCTAssertEqual(result.title, "Workshop")
    }

    func testNumbersAndBackwardsRangesStayText() {
        for text in ["Read pages 10-12", "Chapters 1-2", "Score 3-1", "Call 14:00-13:00", "Open 25:00-26:00", "Meet 9-10:99am"] {
            let result = expand(text)
            XCTAssertNil(result.startDate, text)
            XCTAssertEqual(result.title, text)
        }
    }

    func testOffByDefaultAndWithoutDateDetection() {
        XCTAssertNil(magic("Standup 9-10am").startDate)
        XCTAssertEqual(magic("Standup 9-10am").title, "Standup 9-10am")
        XCTAssertEqual(expand("Standup 9-10am", detectDates: false).title, "Standup 9-10am")
    }

    func testTokenKind() {
        let token = expand("Standup 9-10am").tokens.first {
            if case .duration = $0.kind { return true } else { return false }
        }
        XCTAssertEqual(token?.text, "9-10am")
        XCTAssertEqual(token?.kind, .duration(startISO: "2021-06-24T09:00:00Z", endISO: "2021-06-24T10:00:00Z"))
    }
}

final class QuickAddExpandedDurationTests: XCTestCase {
    func testDurationFollowsTheDueTime() {
        let cases: [(String, String)] = [
            ("for 1h", "2021-6-24 16:0"), ("for 30m", "2021-6-24 15:30"), ("for 1h30m", "2021-6-24 16:30"),
            ("for 1h 15m", "2021-6-24 16:15"), ("for 1.5 hours", "2021-6-24 16:30"), ("for 2 hours 15 minutes", "2021-6-24 17:15"),
            ("for 45 mins", "2021-6-24 15:45"), ("for 90 minutes", "2021-6-24 16:30")
        ]
        for (duration, end) in cases {
            let result = expand("Review at 3pm \(duration)")
            XCTAssertEqual(result.title, "Review", duration)
            XCTAssertEqual(stamp(result.dueDate), "2021-6-24 15:0", duration)
            XCTAssertEqual(stamp(result.startDate), "2021-6-24 15:0", duration)
            XCTAssertEqual(stamp(result.endDate), end, duration)
        }
    }

    func testDurationBeforeTheTimeToo() {
        let result = expand("Review for 1h tomorrow at 3pm")
        XCTAssertEqual(result.title, "Review")
        XCTAssertEqual(stamp(result.endDate), "2021-6-25 16:0")
    }

    func testDurationNeedsATimeOfDay() {
        let result = expand("Review tomorrow for 1h")
        XCTAssertNil(result.startDate)
        XCTAssertEqual(result.title, "Review for 1h")
        let none = expand("Review for 1h")
        XCTAssertNil(none.startDate)
        XCTAssertEqual(none.title, "Review for 1h")
    }

    func testTheDefaultDueTimeGivesItATime() {
        let result = expand("Review tomorrow for 1h", defaultTime: DefaultDueTime(hour: 9, minute: 0))
        XCTAssertEqual(stamp(result.startDate), "2021-6-25 9:0")
        XCTAssertEqual(stamp(result.endDate), "2021-6-25 10:0")
        XCTAssertEqual(result.title, "Review")
    }

    func testOtherForPhrasesStayText() {
        for text in ["Review at 3pm for 3 months", "Review at 3pm for 5 apples", "Review at 3pm for 0h", "Review at 3pm for 500h"] {
            let result = expand(text)
            XCTAssertNil(result.startDate, text)
            XCTAssertTrue(result.title.contains("for"), text)
        }
    }

    func testARangeWinsOverADuration() {
        let result = expand("Review 9-10am for 3h")
        XCTAssertEqual(stamp(result.endDate), "2021-6-24 10:0")
        XCTAssertEqual(result.title, "Review for 3h")
    }

    func testDeadlineKeepsTheEndDate() {
        let result = expand("Review at 3pm for 1h {friday}")
        XCTAssertEqual(stamp(result.startDate), "2021-6-24 15:0")
        XCTAssertEqual(stamp(result.endDate), "2021-6-25")
    }

    func testOffByDefault() {
        let result = magic("Review at 3pm for 1h")
        XCTAssertNil(result.startDate)
        XCTAssertEqual(result.title, "Review for 1h")
    }
}

final class QuickAddExpandedWholeLineTests: XCTestCase {
    func testEverythingTogether() {
        let result = expand("Plan the offsite tomorrow 9-10am p2 every! week {in 2 weeks} *work +Team")
        XCTAssertEqual(result.title, "Plan the offsite")
        XCTAssertEqual(result.priority, 3)
        XCTAssertEqual(result.repeatMode, 2)
        XCTAssertEqual(result.labelTitles, ["work"])
        XCTAssertEqual(result.projectTitle, "Team")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25 9:0")
        XCTAssertEqual(stamp(result.startDate), "2021-6-25 9:0")
        XCTAssertEqual(stamp(result.endDate), "2021-7-8")
    }

    func testTokensCoverTheInputAndNoneOverlap() {
        let input = "Plan tomorrow 9-10am p2 every! week {friday} *work"
        let tokens = expand(input).tokens
        XCTAssertEqual(tokens.map(\.text).joined(), input)
        XCTAssertEqual(tokens.first?.start, 0)
        XCTAssertEqual(tokens.last?.end, input.utf16.count)
    }

    func testOffLeavesTheWholeLineAlone() {
        let line = "Plan 9-10am p2 {friday} for 1h every! day"
        let result = magic(line)
        XCTAssertEqual(result.title, line)
        XCTAssertTrue(nothingParsed(result))
        XCTAssertNil(result.startDate)
        XCTAssertNil(result.endDate)
    }

    func testQuotedLinesAreLiteral() {
        let result = expand("\"Plan 9-10am p2 {friday}\"")
        XCTAssertEqual(result.title, "Plan 9-10am p2 {friday}")
        XCTAssertNil(result.endDate)
        XCTAssertNil(result.priority)
    }

    func testTaskParseCarriesTheFlag() {
        let withFlag = parseQuickAddTask("Fix p1", now: june24, calendar: utcCalendar, expanded: true)
        XCTAssertEqual(withFlag.priority, 4)
        XCTAssertNil(parseQuickAddTask("Fix p1", now: june24, calendar: utcCalendar).priority)
        // A line of only expanded words keeps its text, like any line the magic would empty.
        XCTAssertEqual(parseQuickAddTask("p1", now: june24, calendar: utcCalendar, expanded: true).title, "p1")
    }
}
