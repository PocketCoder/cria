import XCTest
@testable import CriaKit

final class GanttTreeTests: XCTestCase {
    private struct Fixture {
        let id: Int
        var start: String?
        var end: String?
        var due: String?
    }

    private func json(_ fixture: Fixture) -> String {
        func field(_ name: String, _ value: String?) -> String { value.map { "\"\(name)\": \"\($0)\"," } ?? "" }
        return """
        {"id": \(fixture.id), "project_id": 1, "title": "t\(fixture.id)", "done": false,
         \(field("start_date", fixture.start)) \(field("end_date", fixture.end)) \(field("due_date", fixture.due))
         "updated": "2026-06-09T10:00:00Z"}
        """
    }

    /// Seeds tasks and returns them in order, with a map from server id to local id.
    private func seed(_ fixtures: [Fixture]) throws -> (store: CriaStore, tasks: [TaskRecord]) {
        let store = try makeStore()
        let project = try seedProject(store)
        for fixture in fixtures {
            let text = json(fixture)
            try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, text), rawJSON: text)
        }
        let tasks = try store.tasks(matching: TaskQuery(projectLocalId: project))
        let ordered = fixtures.compactMap { fixture in tasks.first { $0.serverId == fixture.id } }
        return (store, ordered)
    }

    private func day(_ iso: String) -> Int? { GanttTree.day(fromISO: iso) }

    func testFlatOrderReadsOwnDatesAndFallsBackToDue() throws {
        let seeded = try seed([
            Fixture(id: 1, start: "2024-03-01T00:00:00Z", end: "2024-03-05T00:00:00Z"),
            Fixture(id: 2),
            Fixture(id: 3, due: "2024-03-10T00:00:00Z")
        ])
        let nodes = GanttTree.build(tasks: seeded.tasks, childMap: [:])
        XCTAssertEqual(nodes.count, 3)
        XCTAssertEqual(nodes[0].startDay, day("2024-03-01T00:00:00Z"))
        XCTAssertEqual(nodes[0].endDay, day("2024-03-05T00:00:00Z"))
        XCTAssertTrue(nodes[0].hasOwnDates)
        XCTAssertNil(nodes[1].startDay)
        XCTAssertFalse(nodes[1].hasOwnDates)
        XCTAssertEqual(nodes[2].endDay, day("2024-03-10T00:00:00Z"))
        XCTAssertTrue(nodes[2].hasOwnDates)
    }

    func testDatelessParentDerivesRangeFromChildrenDepthFirst() throws {
        let seeded = try seed([
            Fixture(id: 1),
            Fixture(id: 2, start: "2024-03-02T00:00:00Z", end: "2024-03-04T00:00:00Z"),
            Fixture(id: 3, start: "2024-03-05T00:00:00Z", end: "2024-03-08T00:00:00Z")
        ])
        let parent = seeded.tasks[0].localId
        let kids = [seeded.tasks[1].localId, seeded.tasks[2].localId]
        let nodes = GanttTree.build(tasks: seeded.tasks, childMap: [parent: kids])
        XCTAssertEqual(nodes.map(\.taskLocalId), [parent] + kids)
        XCTAssertTrue(nodes[0].isParent)
        XCTAssertEqual(nodes[0].childIds, kids)
        XCTAssertEqual(nodes[0].startDay, day("2024-03-02T00:00:00Z"))
        XCTAssertEqual(nodes[0].endDay, day("2024-03-08T00:00:00Z"))
        XCTAssertFalse(nodes[0].hasOwnDates)
        XCTAssertTrue(nodes[0].hasDerivedDates)
        XCTAssertEqual(nodes.map(\.indentLevel), [0, 1, 1])
    }

    func testIndentCapsAtFourAndAbsentParentMakesARoot() throws {
        let seeded = try seed((1...6).map { Fixture(id: $0) })
        let ids = seeded.tasks.map(\.localId)
        var childMap: [String: [String]] = [:]
        for index in 0..<5 { childMap[ids[index]] = [ids[index + 1]] }
        let nodes = GanttTree.build(tasks: seeded.tasks, childMap: childMap)
        XCTAssertEqual(nodes.map(\.indentLevel), [0, 1, 2, 3, 4, 4])
        let orphan = GanttTree.build(tasks: [seeded.tasks[0]], childMap: ["missing": [ids[0]]])
        XCTAssertEqual(orphan.map(\.indentLevel), [0])
    }

    func testVisibleHidesCollapsedAndDatelessSubtrees() {
        let parent = GanttNode(taskLocalId: "p", childIds: ["c1", "c2"], startDay: 1, endDay: 5, hasDerivedDates: true)
        let first = GanttNode(taskLocalId: "c1", indentLevel: 1, startDay: 1, endDay: 2)
        let second = GanttNode(taskLocalId: "c2", indentLevel: 1, startDay: nil, endDay: nil, hasOwnDates: false)
        let nodes = [parent, first, second]
        XCTAssertEqual(GanttTree.visible(nodes, collapsed: ["p"], showDateless: true).map(\.taskLocalId), ["p"])
        XCTAssertEqual(GanttTree.visible(nodes, collapsed: [], showDateless: true).map(\.taskLocalId), ["p", "c1", "c2"])
        XCTAssertEqual(GanttTree.visible(nodes, collapsed: [], showDateless: false).map(\.taskLocalId), ["p", "c1"])
    }

    func testParentMapAndAnchors() {
        let parent = GanttNode(taskLocalId: "p", childIds: ["c1"], startDay: 1, endDay: 5)
        let child = GanttNode(taskLocalId: "c1", indentLevel: 1, childIds: ["gc"], startDay: 1, endDay: 2)
        let grand = GanttNode(taskLocalId: "gc", indentLevel: 2, startDay: 1, endDay: 1)
        let parents = GanttTree.parentMap([parent, child, grand])
        XCTAssertEqual(parents, ["c1": "p", "gc": "c1"])
        XCTAssertEqual(GanttTree.visibleAnchor(of: "c1", visibleIds: ["p", "c1"], parents: parents, collapsed: []), "c1")
        XCTAssertEqual(GanttTree.visibleAnchor(of: "gc", visibleIds: ["p"], parents: parents, collapsed: ["p"]), "p")
        XCTAssertNil(GanttTree.visibleAnchor(of: "c1", visibleIds: ["p"], parents: parents, collapsed: []))
    }

    func testReorderRootBlocksCarriesSubtrees() {
        let first = GanttNode(taskLocalId: "a", startDay: 1, endDay: 1)
        let parent = GanttNode(taskLocalId: "p", childIds: ["c1"], startDay: 1, endDay: 2)
        let child = GanttNode(taskLocalId: "c1", indentLevel: 1, startDay: 1, endDay: 2)
        let last = GanttNode(taskLocalId: "b", startDay: 1, endDay: 1)
        let nodes = [first, parent, child, last]
        XCTAssertEqual(GanttTree.reorderRootBlocks(nodes, rootOrder: ["a", "p", "b"]).map(\.taskLocalId), ["a", "p", "c1", "b"])
        XCTAssertEqual(GanttTree.reorderRootBlocks(nodes, rootOrder: ["p", "a", "b"]).map(\.taskLocalId), ["p", "c1", "a", "b"])
        XCTAssertEqual(GanttTree.reorderRootBlocks(nodes, rootOrder: ["b", "a"]).map(\.taskLocalId), ["b", "a", "p", "c1"])
    }

    func testRelationQueriesScopeToProjectAndCanonicalKinds() throws {
        let seeded = try seed([Fixture(id: 1), Fixture(id: 2), Fixture(id: 3)])
        let ids = seeded.tasks.map(\.localId)
        let project = seeded.tasks[0].projectLocalId
        try seeded.store.addRelation(taskLocalId: ids[0], otherTaskLocalId: ids[1], kind: .blocking)
        try seeded.store.addRelation(taskLocalId: ids[1], otherTaskLocalId: ids[2], kind: .precedes)
        try seeded.store.addRelation(taskLocalId: ids[0], otherTaskLocalId: ids[2], kind: .subtask)
        let edges = try seeded.store.ganttEdges(projectLocalId: project)
        XCTAssertEqual(Set(edges.map(\.kind)), [.blocking, .precedes])
        XCTAssertEqual(edges.count, 2)
        XCTAssertTrue(edges.contains(GanttEdge(fromLocalId: ids[0], toLocalId: ids[1], kind: .blocking)))
        XCTAssertEqual(try seeded.store.subtaskMap(projectLocalId: project), [ids[0]: [ids[2]]])
    }
}
