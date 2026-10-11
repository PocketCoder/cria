import XCTest
@testable import CriaKit

private struct StubModel: OnDeviceModel {
    var status = "available"
    var reply = ""

    func availability() async -> String { status }
    func generate(instructions: String, prompt: String) async throws -> String { reply }
}

final class RambleTests: XCTestCase {
    func testSplitsNotes() {
        let split = Ramble.splitNotes("Book dentist || Needs a morning slot")
        XCTAssertEqual(split.text, "Book dentist")
        XCTAssertEqual(split.notes, "Needs a morning slot")
        XCTAssertNil(Ramble.splitNotes("Book dentist").notes)
        XCTAssertNil(Ramble.splitNotes("Book dentist ||  ").notes)
    }

    func testSplitsSuggestionOnlyWhenMagicIsOn() {
        let split = Ramble.splitSuggestion("Email landlord tomorrow ~ +Flat *house", mode: .vikunja)
        XCTAssertEqual(split.line, "Email landlord tomorrow")
        XCTAssertEqual(split.suggestion, "+Flat *house")
        XCTAssertNil(Ramble.splitSuggestion("Buy milk +Home", mode: .vikunja).suggestion)
        XCTAssertEqual(Ramble.splitSuggestion("Fix ~ approx 5 things", mode: .vikunja).suggestion, "approx 5 things")
        XCTAssertEqual(Ramble.splitSuggestion("Fix ~ x", mode: .disabled).line, "Fix ~ x")
    }

    func testDraftsAreNumberedAndIncluded() {
        let drafts = Ramble.drafts(fromLines: ["a", "b || note"], firstId: 5)
        XCTAssertEqual(drafts.map(\.id), [5, 6])
        XCTAssertEqual(drafts.map(\.include), [true, true])
        XCTAssertEqual(drafts[1].notes, "note")
        XCTAssertTrue(Ramble.drafts(fromLines: [], firstId: 0).isEmpty)
    }

    func testChosenSkipsUntickedAndTitlelessLines() {
        var drafts = Ramble.drafts(fromLines: ["Buy milk +Home", "+Home tomorrow", "!3 *errands", "Call mum", "skip me"])
        drafts[4].include = false
        XCTAssertEqual(Ramble.chosen(drafts, mode: .vikunja).map(\.line), ["Buy milk +Home", "Call mum"])
    }

    func testHasTitleFollowsTheMode() {
        XCTAssertFalse(Ramble.hasTitle("+Home tomorrow", mode: .vikunja))
        XCTAssertTrue(Ramble.hasTitle("  Plan trip  ", mode: .vikunja))
        XCTAssertFalse(Ramble.hasTitle("#Home tomorrow", mode: .todoist))
        XCTAssertTrue(Ramble.hasTitle("*errands", mode: .todoist))
        XCTAssertTrue(Ramble.hasTitle("+Home tomorrow", mode: .disabled))
        XCTAssertFalse(Ramble.hasTitle("   ", mode: .disabled))
        XCTAssertTrue(Ramble.hasTitle(" \"+Home tomorrow\" ", mode: .vikunja))
    }

    func testNotesToHtmlEscapes() {
        XCTAssertEqual(Ramble.notesToHtml("a <b> & c"), "<p>a &lt;b&gt; &amp; c</p>")
        XCTAssertEqual(Ramble.taskCount(1), "1 task")
        XCTAssertEqual(Ramble.taskCount(3), "3 tasks")
    }

    func testCreateFromQuickAddUsesProjectTokenAndFallback() throws {
        let store = try makeStore()
        let home = try seedProject(store, serverId: 10, title: "Home")
        let inbox = try seedProject(store, serverId: 11, title: "Inbox")
        let projects = try store.projects()
        let named = try store.createFromQuickAdd(line: "Fix tap +Home !3", projects: projects, fallbackProjectId: inbox, mode: .vikunja,
                                                 notes: "Needs <washer>")
        XCTAssertEqual(named?.projectLocalId, home)
        XCTAssertEqual(named?.priority, 3)
        XCTAssertEqual(named?.description, "<p>Needs &lt;washer&gt;</p>")
        let unknown = try store.createFromQuickAdd(line: "Call mum +Nowhere", projects: projects, fallbackProjectId: inbox, mode: .vikunja)
        XCTAssertEqual(unknown?.projectLocalId, inbox)
        XCTAssertNil(try store.createFromQuickAdd(line: "+Home", projects: projects, fallbackProjectId: inbox, mode: .vikunja))
    }

    func testRambleFeatureParsesModelOutput() async throws {
        let reply = "Output:\n- Call the dentist next week\n- Email landlord ~ +Flat || Rent is late\n"
        let features = AIFeatures(model: StubModel(reply: reply))
        let drafts = try await features.ramble("um", context: AIPrompts.RambleContext(projects: ["Flat"], labels: []))
        XCTAssertEqual(drafts.map(\.line), ["Call the dentist next week", "Email landlord"])
        XCTAssertEqual(drafts[1].suggestion, "+Flat")
        XCTAssertEqual(drafts[1].notes, "Rent is late")
    }

    func testSubtasksAreCapped() async throws {
        let reply = (1...12).map { "step \($0)" }.joined(separator: "\n")
        let steps = try await AIFeatures(model: StubModel(reply: reply)).subtasks(title: "Plan", descriptionHtml: nil)
        XCTAssertEqual(steps.count, 8)
    }

    func testTidyListFallsBackToRawLines() async throws {
        let features = AIFeatures(model: StubModel(reply: "  \n"))
        let lines = try await features.tidyList(["milk", "eggs"])
        XCTAssertEqual(lines, ["milk", "eggs"])
    }

    func testAvailabilityGate() async {
        XCTAssertNil(await AIFeatures(model: StubModel()).unavailableReason())
        let reason = await AIFeatures(model: StubModel(status: "unsupportedOS")).unavailableReason()
        XCTAssertEqual(reason, "unsupportedOS")
        XCTAssertFalse(AIFeatures.isOfferable(reason: "unavailable: deviceNotEligible"))
        XCTAssertFalse(AIFeatures.isOfferable(reason: "unsupportedOS"))
        XCTAssertTrue(AIFeatures.isOfferable(reason: "unavailable: appleIntelligenceNotEnabled"))
        XCTAssertTrue(AIFeatures.isOfferable(reason: nil))
    }
}
