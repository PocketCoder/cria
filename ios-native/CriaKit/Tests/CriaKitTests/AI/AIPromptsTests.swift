import XCTest
@testable import CriaKit

final class AIPromptsTests: XCTestCase {
    private func date(_ iso: String) throws -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.locale = Locale(identifier: "en_GB")
        return try XCTUnwrap(formatter.date(from: iso))
    }

    func testParseLinesStripsDecorationAndDedupes() {
        let text = "Output:\nHere are your tasks:\n- Buy milk\n2. Call mum\n3) \"Pay rent\"\n* Walk dog\nbuy MILK\n\n"
        XCTAssertEqual(AIPrompts.parseLines(text), ["Buy milk", "Call mum", "Pay rent", "Walk dog"])
    }

    func testParseLinesKeepsLabelToken() {
        XCTAssertEqual(AIPrompts.parseLines("*errands Buy stamps"), ["*errands Buy stamps"])
    }

    func testParseLinesFullStopAndEllipsis() {
        XCTAssertEqual(AIPrompts.parseLines("Book trains.\nThink about it..."), ["Book trains", "Think about it..."])
    }

    func testParseLinesCap() {
        XCTAssertEqual(AIPrompts.parseLines("a\nb\nc", max: 2), ["a", "b"])
    }

    func testStripHtml() {
        XCTAssertEqual(AIPrompts.stripHtml("<p>Hi &amp; <b>bye</b></p><p>a&nbsp;b<br>c</p>"), "Hi & bye\na b\nc")
    }

    func testClip() {
        XCTAssertEqual(AIPrompts.clip("abcdef", max: 3), "abc…")
        XCTAssertEqual(AIPrompts.clipStart("abcdef", max: 3), "…def")
        XCTAssertEqual(AIPrompts.clip("abc", max: 3), "abc")
    }

    func testRambleListsAndQuotesNames() {
        let context = AIPrompts.RambleContext(projects: ["Work", "Home Admin"], labels: [])
        let text = AIPrompts.rambleInstructions(context)
        XCTAssertTrue(text.contains("Work, \"Home Admin\""))
        XCTAssertTrue(text.contains("Existing labels: (none)"))
    }

    func testRambleQuotesExactlyWhatTheParserNeedsQuoted() {
        let context = AIPrompts.RambleContext(projects: ["Work", "Café", "Mum's", "Home Admin", "a_b-c"], labels: ["Naïve", "urgent"])
        let text = AIPrompts.rambleInstructions(context)
        XCTAssertTrue(text.contains("Work, \"Café\", \"Mum's\", \"Home Admin\", a_b-c"))
        XCTAssertTrue(text.contains("Existing labels: \"Naïve\", urgent"))
    }

    func testRambleGivesTodayAndEndOfMonth() throws {
        let now = try date("2026-02-10T09:00:00")
        let text = AIPrompts.rambleInstructions(AIPrompts.RambleContext(projects: [], labels: [], now: now))
        XCTAssertTrue(text.contains("Today is Tuesday 10 February 2026."))
        XCTAssertTrue(text.contains("Renew car insurance feb 28 !3"))
    }

    func testRambleVikunjaIsTheDefault() throws {
        let now = try date("2026-02-10T09:00:00")
        let base = AIPrompts.RambleContext(projects: ["Home Admin"], labels: ["car"], now: now)
        var explicit = base
        explicit.mode = .vikunja
        XCTAssertEqual(AIPrompts.rambleInstructions(base), AIPrompts.rambleInstructions(explicit))
        let text = AIPrompts.rambleInstructions(base)
        XCTAssertTrue(text.contains("+Project to file it"))
        XCTAssertTrue(text.contains("like +\"Home Admin\""))
        XCTAssertTrue(text.contains("*label to tag it"))
        XCTAssertTrue(text.contains("!3 only if"))
        XCTAssertTrue(text.contains("is a suggestion, not a choice"))
        XCTAssertTrue(text.contains(" ~ "))
    }

    func testRambleTodoistSyntax() throws {
        let now = try date("2026-02-10T09:00:00")
        let context = AIPrompts.RambleContext(projects: ["Work", "Home Admin", "Mum's"], labels: ["car"], now: now, mode: .todoist)
        let text = AIPrompts.rambleInstructions(context)
        XCTAssertTrue(text.contains("#Project to file it"))
        XCTAssertTrue(text.contains("like #\"Home Admin\" or #\"Mum's\""))
        XCTAssertTrue(text.contains("@label to tag it"))
        XCTAssertFalse(text.contains("+Project"))
        XCTAssertFalse(text.contains("*label"))
    }

    func testRambleWithMagicOffAsksForPlainTitles() throws {
        let now = try date("2026-02-10T09:00:00")
        let context = AIPrompts.RambleContext(projects: ["Work"], labels: ["car"], now: now, mode: .disabled)
        let text = AIPrompts.rambleInstructions(context)
        XCTAssertTrue(text.contains("no symbols or tags"))
        XCTAssertTrue(text.contains("Keep every date and repeat the person mentions in the title, in plain words"))
        XCTAssertTrue(text.contains("Renew car insurance before the end of the month"))
        XCTAssertFalse(text.contains("Work"))
    }

    func testSubtaskAndCommentPrompts() {
        XCTAssertEqual(AIPrompts.subtaskPrompt(title: "Plan trip", descriptionHtml: "<p>Rome</p>"), "Task: Plan trip\nNotes: Rome")
        XCTAssertEqual(AIPrompts.subtaskPrompt(title: "Plan trip", descriptionHtml: nil), "Task: Plan trip")
        let comment = AIPrompts.ThreadComment(authorName: "Sam", comment: "<p>Done?</p>", createdAt: "2026-10-01T10:00:00Z")
        XCTAssertEqual(AIPrompts.commentsPrompt([comment]), "Sam (2026-10-01): Done?")
    }

    func testErrorMessages() {
        XCTAssertTrue(AIPrompts.errorMessage("unavailable: appleIntelligenceNotEnabled").contains("Turn on Apple Intelligence"))
        XCTAssertTrue(AIPrompts.errorMessage("unsupportedOS").contains("iOS 26"))
        XCTAssertEqual(AIPrompts.errorMessage("cancelled"), "Cancelled.")
        XCTAssertEqual(AIPrompts.errorMessage("boom"), "Something went wrong: boom")
    }
}
