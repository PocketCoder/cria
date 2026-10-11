import XCTest
@testable import CriaKit

final class ShoppingItemsTests: XCTestCase {
    func testStripsBulletsCheckboxesAndNumbers() {
        XCTAssertEqual(ShoppingItems.parse(["- Milk", "• Eggs", "[ ] Bread", "1. Butter", "2) Jam"]),
                       ["Milk", "Eggs", "Bread", "Butter", "Jam"])
    }

    func testDropsHeadings() {
        XCTAssertEqual(ShoppingItems.parse(["Shopping List", "Milk", "Groceries:", "Eggs"]), ["Milk", "Eggs"])
    }

    func testDedupesCaseInsensitively() {
        XCTAssertEqual(ShoppingItems.parse(["Milk", "milk", "MILK"]), ["Milk"])
    }

    func testSplitsCommaAndAndLines() {
        XCTAssertEqual(ShoppingItems.parse(["milk, eggs and bread"]), ["milk", "eggs", "bread"])
    }

    func testKeepsDecimalQuantitiesWhole() {
        XCTAssertEqual(ShoppingItems.parse(["1,5 kg flour"]), ["1,5 kg flour"])
    }

    func testKeepsQuantityPrefixes() {
        XCTAssertEqual(ShoppingItems.parse(["2x Apples", "500g Cheese"]), ["2x Apples", "500g Cheese"])
    }

    func testIgnoresBlankLinesAndWhitespace() {
        XCTAssertEqual(ShoppingItems.parse(["", "   ", "\tMilk\t", "Eggs "]), ["Milk", "Eggs"])
    }

    func testHandlesEmbeddedNewlines() {
        XCTAssertEqual(ShoppingItems.parse(["Milk\nEggs\nBread"]), ["Milk", "Eggs", "Bread"])
    }

    func testDropsMarkerOnlyAndLetterlessLines() {
        XCTAssertEqual(ShoppingItems.parse(["---", "•", "42", "Milk"]), ["Milk"])
    }

    func testSelectionAndLabels() {
        var items = ShoppingItems.drafts(from: ["a1", "b2", "  "])
        items[1].include = false
        XCTAssertEqual(ShoppingItems.selected(items).map(\.id), [0])
        XCTAssertEqual(ShoppingItems.selectedLabel(1), "1 item selected")
        XCTAssertEqual(ShoppingItems.addButtonLabel(3), "Add 3 tasks")
        XCTAssertEqual(ShoppingItems.withoutSaved(items, savedIds: [0]).map(\.id), [1, 2])
    }

    func testCreatesTasksAndTagsThem() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        var saved: [Int] = []
        try store.createTasks(fromItems: ShoppingItems.drafts(from: ["Milk", "Eggs"]), projectId: project, label: "shopping") {
            saved.append($0.id)
        }
        XCTAssertEqual(saved, [0, 1])
        XCTAssertEqual(try store.tasks(matching: TaskQuery(projectLocalId: project)).map(\.title).sorted(), ["Eggs", "Milk"])
    }
}
