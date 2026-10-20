import XCTest
@testable import CriaKit

final class KanbanCollapseTests: XCTestCase {
    func testRoundTrip() {
        let ids: Set<String> = ["b", "a", "c"]
        XCTAssertEqual(KanbanCollapse.decode(KanbanCollapse.encode(ids)), ids)
        XCTAssertEqual(KanbanCollapse.decode(""), [])
    }

    func testToggleAddsThenRemoves() {
        let once = KanbanCollapse.toggled("", bucketLocalId: "a")
        XCTAssertEqual(KanbanCollapse.decode(once), ["a"])
        let two = KanbanCollapse.toggled(once, bucketLocalId: "b")
        XCTAssertEqual(KanbanCollapse.decode(two), ["a", "b"])
        XCTAssertEqual(KanbanCollapse.decode(KanbanCollapse.toggled(two, bucketLocalId: "a")), ["b"])
    }

    func testStorageKeyIsPerView() {
        XCTAssertNotEqual(KanbanCollapse.storageKey(viewLocalId: "v1"), KanbanCollapse.storageKey(viewLocalId: "v2"))
    }
}
