import XCTest
@testable import CriaKit

/// Ramble lines as the on-device model really writes them, through to the proposals the review list shows.
final class RambleProposalTests: XCTestCase {
    private let tomorrow = "2026-05-28T00:00:00Z"

    private func proposals(_ lines: [String], mode: QuickAddMagicMode = .vikunja, projects: [ProjectRecord] = [],
                           knownLabels: [String]? = nil) -> [RambleProposal] {
        let drafts = Ramble.drafts(fromLines: AIPrompts.parseLines(lines.joined(separator: "\n")), mode: mode)
        return Ramble.proposals(from: drafts, projects: projects, mode: mode, knownLabels: knownLabels,
                                now: quickAddNow, calendar: utcCalendar)
    }

    func testTomorrowLeavesTheTitleInEveryShapeTheModelWrites() {
        let lines = [
            "Email the landlord tomorrow",
            "Call the bank Tomorrow.",
            "Tomorrow: renew the parking permit",
            "Pay the gas bill, tomorrow,",
            "Book the MOT on tomorrow",
            "Send the invoice by tomorrow",
            "Pick up the parcel (tomorrow)",
            "Water the plants - tomorrow",
            "Return the library books tomorrow!",
            "Post the birthday card due tomorrow"
        ]
        let result = proposals(lines)
        XCTAssertEqual(result.map(\.title), [
            "Email the landlord", "Call the bank", "Renew the parking permit", "Pay the gas bill", "Book the MOT",
            "Send the invoice", "Pick up the parcel", "Water the plants", "Return the library books",
            "Post the birthday card"
        ])
        XCTAssertEqual(Set(result.map(\.dueDate)), [tomorrow])
    }

    func testOtherDateWordingIsNormalised() {
        let result = proposals([
            "Call mum tomorrow at 5 p.m.",
            "Clean the oven the day after tomorrow",
            "Chase the plumber in two days",
            "Renew passport in a week",
            "Drop off the keys before Friday"
        ])
        XCTAssertEqual(result.map(\.title), [
            "Call mum", "Clean the oven", "Chase the plumber", "Renew passport", "Drop off the keys"
        ])
        XCTAssertEqual(result[0].dueDate, "2026-05-28T17:00:00Z")
        XCTAssertEqual(result[1].dueDate, "2026-05-29T00:00:00Z")
        XCTAssertEqual(result[2].dueDate, "2026-05-29T00:00:00Z")
        XCTAssertEqual(result[3].dueDate, "2026-06-03T00:00:00Z")
        XCTAssertEqual(result[4].dueDate, "2026-05-29T00:00:00Z")
    }

    func testNormaliseLeavesOrdinaryWordsAlone() {
        XCTAssertEqual(Ramble.normaliseLine("Buy a present for Sam"), "Buy a present for Sam")
        XCTAssertEqual(Ramble.normaliseLine("Stand by the door"), "Stand by the door")
        XCTAssertEqual(Ramble.normaliseLine("Read in a quiet room"), "Read in a quiet room")
        XCTAssertEqual(Ramble.tidyTitle("Read \u{201C}Dune\u{201D}"), "Read \u{201C}Dune\u{201D}")
        XCTAssertEqual(Ramble.tidyTitle("Ask Sam, then Jo"), "Ask Sam, then Jo")
    }

    func testTokensBecomeFieldsInTheUsersMode() throws {
        let store = try makeStore()
        let flat = try seedProject(store, serverId: 3, title: "Flat")
        let projects = try store.projects()
        let vikunja = proposals(["Email the landlord tomorrow +Flat *house !3"], projects: projects)
        XCTAssertEqual(vikunja.first?.title, "Email the landlord")
        XCTAssertEqual(vikunja.first?.projectLocalId, flat)
        XCTAssertEqual(vikunja.first?.labelTitles, ["house"])
        XCTAssertEqual(vikunja.first?.priority, 3)
        XCTAssertEqual(vikunja.first?.dueDate, tomorrow)
        let todoist = proposals(["Email the landlord Tomorrow #Flat @house"], mode: .todoist, projects: projects)
        XCTAssertEqual(todoist.first?.projectLocalId, flat)
        XCTAssertEqual(todoist.first?.labelTitles, ["house"])
        XCTAssertEqual(todoist.first?.dueDate, tomorrow)
    }

    func testMagicOffParsesNothing() {
        let result = proposals(["Email the landlord tomorrow +Flat"], mode: .disabled)
        XCTAssertEqual(result.first?.title, "Email the landlord tomorrow +Flat")
        XCTAssertNil(result.first?.dueDate)
        XCTAssertNil(result.first?.projectLocalId)
    }

    func testUnknownProjectAndInventedLabelsAreDropped() {
        let result = proposals(["Fix the tap +Nowhere *house *madeup"], knownLabels: ["House"])
        XCTAssertNil(result.first?.projectLocalId)
        XCTAssertEqual(result.first?.labelTitles, ["house"])
        XCTAssertEqual(proposals(["Fix the tap *madeup"]).first?.labelTitles, ["madeup"])
    }

    func testTokenOnlyLinesAreSkippedAndNotesKept() {
        let result = proposals(["+Flat tomorrow", "Book dentist next week || Needs a morning slot"])
        XCTAssertEqual(result.map(\.title), ["Book dentist"])
        XCTAssertEqual(result.first?.notes, "Needs a morning slot")
    }

    func testSuggestionAppliesOnRequest() throws {
        let store = try makeStore()
        let flat = try seedProject(store, serverId: 3, title: "Flat")
        let projects = try store.projects()
        let proposal = try XCTUnwrap(proposals(["Email the landlord ~ +Flat *house"], projects: projects).first)
        XCTAssertNil(proposal.projectLocalId)
        XCTAssertEqual(proposal.suggestion, "+Flat *house")
        let applied = Ramble.applyingSuggestion(to: proposal, projects: projects, mode: .vikunja)
        XCTAssertEqual(applied.projectLocalId, flat)
        XCTAssertEqual(applied.labelTitles, ["house"])
        XCTAssertNil(applied.suggestion)
    }

    func testChosenAndCreate() throws {
        let store = try makeStore()
        let inbox = try seedProject(store, serverId: 1, title: "Inbox")
        let flat = try seedProject(store, serverId: 3, title: "Flat")
        var list = proposals(["Email the landlord tomorrow +Flat !2 || Rent is late", "Skip me", "Buy milk"],
                             projects: try store.projects())
        list[1].include = false
        list[2].title = "  "
        let chosen = Ramble.chosen(list)
        XCTAssertEqual(chosen.map(\.title), ["Email the landlord"])
        let task = try XCTUnwrap(try store.createTask(from: chosen[0], fallbackProjectId: inbox))
        XCTAssertEqual(task.title, "Email the landlord")
        XCTAssertEqual(task.projectLocalId, flat)
        XCTAssertEqual(task.priority, 2)
        XCTAssertEqual(task.dueDate, tomorrow)
        XCTAssertEqual(task.description, "<p>Rent is late</p>")
        let plain = try XCTUnwrap(try store.createTask(from: RambleProposal(id: 9, title: "Call mum"), fallbackProjectId: inbox))
        XCTAssertEqual(plain.projectLocalId, inbox)
        XCTAssertNil(try store.createTask(from: RambleProposal(id: 10, title: " "), fallbackProjectId: inbox))
    }

    func testAutoTagPromptListsCappedNamesAndDropsSuggestions() {
        let projects = (1...40).map { "P\($0)" }
        var context = AIPrompts.RambleContext(projects: projects, labels: ["house", "Home Admin"], autoTag: true)
        let text = AIPrompts.rambleInstructions(context)
        XCTAssertTrue(text.contains("P30,") || text.contains("P30."))
        XCTAssertFalse(text.contains("P31"))
        XCTAssertTrue(text.contains("house, \"Home Admin\""))
        XCTAssertTrue(text.contains("Never make one up"))
        XCTAssertFalse(text.contains(" ~ "))
        context.mode = .todoist
        XCTAssertTrue(AIPrompts.rambleInstructions(context).contains("#Flat @house"))
        context.mode = .disabled
        XCTAssertFalse(AIPrompts.rambleInstructions(context).contains("P1"))
        context.autoTag = false
        context.mode = .vikunja
        XCTAssertTrue(AIPrompts.rambleInstructions(context).contains("is a suggestion, not a choice"))
    }
}
