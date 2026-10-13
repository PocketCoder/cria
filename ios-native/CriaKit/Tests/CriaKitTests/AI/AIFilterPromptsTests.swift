import XCTest
@testable import CriaKit

/// Replies in order and records every prompt it was given.
private actor ScriptedModel: OnDeviceModel {
    private var replies: [String]
    private(set) var prompts: [String] = []

    init(_ replies: [String]) {
        self.replies = replies
    }

    func availability() async -> String { AIFeatures.available }

    func generate(instructions: String, prompt: String) async throws -> String {
        prompts.append(prompt)
        return replies.isEmpty ? "" : replies.removeFirst()
    }
}

final class AIFilterPromptsTests: XCTestCase {
    func testCleanFilterStripsFencesPrefixAndBackticks() {
        XCTAssertEqual(AIPrompts.cleanFilter("```sql\ndone = false && dueDate < now\n```"), "done = false && dueDate < now")
        XCTAssertEqual(AIPrompts.cleanFilter("\n  Query: `priority >= 3`  \nmore"), "priority >= 3")
        XCTAssertEqual(AIPrompts.cleanFilter("filter:done = true"), "done = true")
        XCTAssertEqual(AIPrompts.cleanFilter("  \n "), "")
    }

    func testFilterInstructionsListNamesAndQuoteOddOnes() {
        let text = AIPrompts.filterInstructions(projects: ["Home", "Home Admin"], labels: [])
        XCTAssertTrue(text.contains("Projects: Home, \"Home Admin\""))
        XCTAssertTrue(text.contains("Labels: (none)"))
        XCTAssertTrue(text.contains("overdue -> done = false && dueDate < now"))
    }

    func testFilterQueryAcceptsAValidFirstAnswer() async throws {
        let model = ScriptedModel(["Query: done = false && dueDate < now"])
        let query = try await AIFeatures(model: model).filterQuery(describing: " overdue ", projects: [], labels: [])
        XCTAssertEqual(query, "done = false && dueDate < now")
        let prompts = await model.prompts
        XCTAssertEqual(prompts, ["overdue"])
    }

    func testFilterQueryRetriesOnceWithTheParseError() async throws {
        let model = ScriptedModel(["done = = false", "done = false", "unused"])
        let query = try await AIFeatures(model: model).filterQuery(describing: "open tasks", projects: [], labels: [])
        XCTAssertEqual(query, "done = false")
        let prompts = await model.prompts
        XCTAssertEqual(prompts.count, 2)
        XCTAssertTrue(prompts[1].hasPrefix("open tasks\n\nYour previous answer \"done = = false\" was invalid: "))
        XCTAssertTrue(prompts[1].hasSuffix("Answer again with a valid query."))
    }

    func testSubtasksSkipTheParentAndExistingOnes() async throws {
        let model = ScriptedModel(["- Plan trip\n1. Book flights\n2. book hotel\n3. Pack bags."])
        let steps = try await AIFeatures(model: model)
            .subtasks(title: "Plan trip", descriptionHtml: "<p>Rome</p>", existing: ["Book hotel"])
        XCTAssertEqual(steps, ["Book flights", "Pack bags"])
        let prompts = await model.prompts
        XCTAssertEqual(prompts, ["Task: Plan trip\nNotes: Rome"])
    }

    func testNewSubtasksIgnoresCase() {
        XCTAssertEqual(AIPrompts.newSubtasks(["A", "b", "C"], parentTitle: "a", existing: ["B"]), ["C"])
    }
}
