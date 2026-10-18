import XCTest
@testable import CriaKit

final class TaskSummaryTests: XCTestCase {
    func testEmptyAndTaglessDescriptionsHaveNoSummary() {
        XCTAssertNil(TaskSummary.line(nil))
        XCTAssertNil(TaskSummary.line(""))
        XCTAssertNil(TaskSummary.line("<p></p><p><img src=\"x.png\"></p>"))
    }

    func testParagraphsJoinOnOneLineWithEntitiesDecoded() {
        let html = "<p>Ring the  <strong>builder</strong></p><p>Ask about&nbsp;the shed &amp; gate</p>"
        XCTAssertEqual(TaskSummary.line(html), "Ring the builder Ask about the shed & gate")
    }

    func testLongTextIsCutWithAnEllipsis() {
        let line = TaskSummary.line("<p>\(String(repeating: "word ", count: 100))</p>", maxLength: 20)
        XCTAssertEqual(line, "word word word word…")
    }

    func testATagCutByTheHeadLimitIsNotLeftAsText() {
        let html = "<p>Short</p>" + String(repeating: "<span class=\"long\"></span>", count: 40)
        XCTAssertEqual(TaskSummary.line(html, maxLength: 10), "Short")
    }

    func testListItemsCarryTheSummary() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Shed", projectLocalId: project, description: "<p>Paint it</p>"))
        let items = try store.attachRowData([task])
        XCTAssertEqual(items.first?.summary, "Paint it")
    }
}
