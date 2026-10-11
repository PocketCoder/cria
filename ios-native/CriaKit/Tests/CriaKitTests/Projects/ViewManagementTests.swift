import XCTest
@testable import CriaKit

final class ViewManagementTests: XCTestCase {
    private func slot(_ id: String, _ position: Double?, placeholder: Bool = false) -> ViewSlot {
        ViewSlot(localId: id, position: position, placeholder: placeholder)
    }

    private var server: [ViewSlot] {
        [slot("list", 100), slot("gantt", 200), slot("table", 300), slot("kanban", 400)]
    }

    func testCanManageViews() {
        XCTAssertTrue(ViewManagement.canManageViews(projectServerId: 5))
        XCTAssertTrue(ViewManagement.canManageViews(projectServerId: nil))
        XCTAssertFalse(ViewManagement.canManageViews(projectServerId: -1))
        XCTAssertFalse(ViewManagement.canManageViews(projectServerId: 0))
    }

    func testLabelAndHint() {
        XCTAssertEqual(ViewManagement.label(ViewSlot(localId: "a", title: "Sprint", kind: .kanban)), "Sprint")
        XCTAssertEqual(ViewManagement.label(ViewSlot(localId: "a", title: "", kind: .kanban)), "Board")
        XCTAssertNil(ViewManagement.kindHint(ViewSlot(localId: "a", title: "Kanban", kind: .kanban)))
        XCTAssertNil(ViewManagement.kindHint(ViewSlot(localId: "a", title: " board ", kind: .kanban)))
        XCTAssertEqual(ViewManagement.kindHint(ViewSlot(localId: "a", title: "Sprint", kind: .kanban)), "Board")
    }

    func testNewViewTitle() {
        XCTAssertEqual(ViewManagement.newViewTitle(draft: "  Roadmap ", kind: .gantt), "Roadmap")
        XCTAssertEqual(ViewManagement.newViewTitle(draft: "   ", kind: .table), "Table")
    }

    func testDeleteBlockers() {
        XCTAssertEqual(ViewManagement.deleteBlocker([slot("a", 1)], localId: "a"), .lastView)
        XCTAssertEqual(ViewManagement.deleteBlocker([slot("a", 1, placeholder: true), slot("b", 2)], localId: "a"), .placeholder)
        XCTAssertEqual(ViewManagement.deleteBlocker([slot("a", 1, placeholder: true)], localId: "a"), .lastView)
        XCTAssertNil(ViewManagement.deleteBlocker([slot("a", 1), slot("b", 2)], localId: "a"))
        XCTAssertNil(ViewManagement.deleteBlocker([slot("a", 1)], localId: "zzz"))
    }

    func testViewAfterDelete() {
        let views = [slot("a", 1), slot("b", 2), slot("c", 3)]
        XCTAssertEqual(ViewManagement.viewAfterDelete(views, deletedId: "b"), "c")
        XCTAssertEqual(ViewManagement.viewAfterDelete(views, deletedId: "c"), "b")
        XCTAssertNil(ViewManagement.viewAfterDelete([slot("a", 1)], deletedId: "a"))
        XCTAssertNil(ViewManagement.viewAfterDelete(views, deletedId: "zzz"))
    }

    func testCanReorder() {
        XCTAssertFalse(ViewManagement.canReorder([slot("a", 1)]))
        XCTAssertTrue(ViewManagement.canReorder([slot("a", 1), slot("b", 2)]))
        XCTAssertFalse(ViewManagement.canReorder([slot("a", 1), slot("b", 2, placeholder: true)]))
    }

    func testReorderReturnsNilWhenNothingMoves() {
        XCTAssertNil(ViewManagement.planReorder(server, activeId: "list", overId: "list"))
        XCTAssertNil(ViewManagement.planReorder(server, activeId: "list", overId: "nope"))
        XCTAssertNil(ViewManagement.planReorder(server, activeId: "nope", overId: "list"))
    }

    func testReorderMidpoints() {
        let down = ViewManagement.planReorder(server, activeId: "list", overId: "table")
        XCTAssertEqual(down?.orderedIds, ["gantt", "table", "list", "kanban"])
        XCTAssertEqual(down?.plan, .midpoint(350))
        let up = ViewManagement.planReorder(server, activeId: "kanban", overId: "gantt")
        XCTAssertEqual(up?.orderedIds, ["list", "kanban", "gantt", "table"])
        XCTAssertEqual(up?.plan, .midpoint(150))
        XCTAssertEqual(ViewManagement.planReorder(server, activeId: "table", overId: "list")?.plan, .midpoint(50))
        XCTAssertEqual(ViewManagement.planReorder(server, activeId: "list", overId: "kanban")?.plan, .midpoint(1424))
    }

    func testReorderReindexesOnCollisionOrMissingPosition() {
        let zeros = [slot("a", 0), slot("b", 0), slot("c", 0)]
        XCTAssertEqual(ViewManagement.planReorder(zeros, activeId: "c", overId: "a")?.plan, .reindex)
        let nulls = [slot("a", 100), slot("b", nil), slot("c", 300)]
        XCTAssertEqual(ViewManagement.planReorder(nulls, activeId: "a", overId: "b")?.plan, .reindex)
    }
}
