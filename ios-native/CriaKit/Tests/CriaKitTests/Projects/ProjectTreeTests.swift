import XCTest
@testable import CriaKit

final class ProjectTreeTests: XCTestCase {
    private func seed(_ store: CriaStore, _ items: [(Int, String, Int?)]) throws {
        for (serverId, title, parent) in items {
            let parentJSON = parent.map { #", "parent_project_id": \#($0)"# } ?? ""
            let json = #"{"id": \#(serverId), "title": "\#(title)"\#(parentJSON), "position": \#(serverId)}"#
            try store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json)
        }
    }

    func testFlattensDepthFirstWithDepth() throws {
        let store = try makeStore()
        try seed(store, [(1, "Work", nil), (2, "Alpha", 1), (3, "Home", nil), (4, "Deep", 2)])
        let rows = ProjectTree.rows(try store.projects())
        XCTAssertEqual(rows.map(\.project.title), ["Work", "Alpha", "Deep", "Home"])
        XCTAssertEqual(rows.map(\.depth), [0, 1, 2, 0])
        XCTAssertEqual(rows.map(\.hasChildren), [true, true, false, false])
    }

    func testCollapsedHidesDescendants() throws {
        let store = try makeStore()
        try seed(store, [(1, "Work", nil), (2, "Alpha", 1)])
        let projects = try store.projects()
        let work = try XCTUnwrap(projects.first { $0.title == "Work" })
        let rows = ProjectTree.rows(projects, collapsed: [work.localId])
        XCTAssertEqual(rows.map(\.project.title), ["Work"])
        XCTAssertFalse(try XCTUnwrap(rows.first).isExpanded)
    }

    func testOrphanSurfacesAsRoot() throws {
        let store = try makeStore()
        try seed(store, [(1, "Work", nil), (2, "Alpha", 1)])
        let alphaOnly = try store.projects().filter { $0.title == "Alpha" }
        XCTAssertEqual(ProjectTree.rows(alphaOnly).map(\.depth), [0])
    }

    func testVisibleDropsPseudoProjectsAndArchived() throws {
        let store = try makeStore()
        try seed(store, [(1, "Real", nil), (-1, "Favorites", nil), (-2, "Saved filter", nil), (5, "Favorites", nil), (6, "Old", nil)])
        let old = try XCTUnwrap(try store.projects().first { $0.title == "Old" })
        try store.updateProject(localId: old.localId, patch: ProjectPatch(isArchived: true))
        XCTAssertEqual(ProjectTree.visible(try store.projects()).map(\.title), ["Real"])
        XCTAssertEqual(ProjectTree.visible(try store.projects(), includeArchived: true).map(\.title), ["Real", "Old"])
    }

    func testArchivedListsOnlyArchivedRealProjectsByTitle() throws {
        let store = try makeStore()
        try seed(store, [(1, "Live", nil), (2, "Zed", nil), (3, "Alpha", nil), (-1, "Favorites", nil)])
        for title in ["Zed", "Alpha"] {
            let project = try XCTUnwrap(try store.projects().first { $0.title == title })
            try store.setProjectArchived(localId: project.localId, archived: true)
        }
        XCTAssertEqual(ProjectTree.archived(try store.projects()).map(\.title), ["Alpha", "Zed"])
        let zed = try XCTUnwrap(try store.projects().first { $0.title == "Zed" })
        try store.setProjectArchived(localId: zed.localId, archived: false)
        XCTAssertEqual(ProjectTree.archived(try store.projects()).map(\.title), ["Alpha"])
    }

    func testUnarchivingUnderArchivedParentIsRefused() throws {
        let store = try makeStore()
        try seed(store, [(1, "Parent", nil), (2, "Child", 1)])
        for title in ["Child", "Parent"] {
            let project = try XCTUnwrap(try store.projects().first { $0.title == title })
            try store.setProjectArchived(localId: project.localId, archived: true)
        }
        let child = try XCTUnwrap(try store.projects().first { $0.title == "Child" })
        XCTAssertThrowsError(try store.setProjectArchived(localId: child.localId, archived: false)) {
            XCTAssertEqual($0 as? ProjectValidationError, .parentArchived)
        }
    }

    func testDragReordersAmongSiblingsOnly() throws {
        let store = try makeStore()
        try seed(store, [(1, "A", nil), (2, "A1", 1), (3, "A2", 1), (4, "B", nil), (5, "C", nil)])
        let rows = ProjectTree.rows(try store.projects())
        XCTAssertEqual(rows.map(\.project.title), ["A", "A1", "A2", "B", "C"])
        let titles: ([String]) -> [String] = { ids in ids.compactMap { id in rows.first { $0.project.localId == id }?.project.title } }
        // C dropped before A: first among the roots.
        let toTop = try XCTUnwrap(ProjectTree.reorderedSiblings(in: rows, from: 4, to: 0))
        XCTAssertEqual(titles(toTop.order), ["C", "A", "B"])
        XCTAssertEqual(titles([toTop.moved]), ["C"])
        // A (with its children showing) dropped at the end.
        let toEnd = try XCTUnwrap(ProjectTree.reorderedSiblings(in: rows, from: 0, to: 5))
        XCTAssertEqual(titles(toEnd.order), ["B", "C", "A"])
        // A2 dropped before A1: only its own siblings change.
        let swap = try XCTUnwrap(ProjectTree.reorderedSiblings(in: rows, from: 2, to: 1))
        XCTAssertEqual(titles(swap.order), ["A2", "A1"])
        // Dropping where it already is changes nothing.
        XCTAssertNil(ProjectTree.reorderedSiblings(in: rows, from: 3, to: 3))
        XCTAssertNil(ProjectTree.reorderedSiblings(in: rows, from: 3, to: 4))
    }

    func testDescendantIds() throws {
        let store = try makeStore()
        try seed(store, [(1, "A", nil), (2, "B", 1), (3, "C", 2), (4, "D", nil)])
        let projects = try store.projects()
        let first = try XCTUnwrap(projects.first { $0.title == "A" })
        let titles = ProjectTree.descendantIds(of: first.localId, in: projects)
            .compactMap { id in projects.first { $0.localId == id }?.title }
        XCTAssertEqual(Set(titles), ["B", "C"])
    }
}

final class ProjectStatsTests: XCTestCase {
    func testOpenCountsIgnoreDoneAndDeleted() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let open = try store.createTask(TaskInput(title: "open", projectLocalId: project, isFavorite: true))
        let done = try store.createTask(TaskInput(title: "done", projectLocalId: project))
        let gone = try store.createTask(TaskInput(title: "gone", projectLocalId: project))
        _ = try store.updateTask(localId: done.localId, patch: TaskPatch(done: true))
        try store.deleteTask(localId: gone.localId)

        XCTAssertEqual(try store.openTaskCounts(), [project: 1])
        XCTAssertEqual(try store.favouriteTaskCount(), 1)
        XCTAssertNotEqual(open.localId, done.localId)
    }

    func testCollapsedRoundTripAndToggle() {
        XCTAssertEqual(ProjectTree.decodeCollapsed("garbage"), [])
        let stored = ProjectTree.encodeCollapsed(["b", "a"])
        XCTAssertEqual(stored, #"["a","b"]"#)
        XCTAssertEqual(ProjectTree.decodeCollapsed(stored), ["a", "b"])
        XCTAssertEqual(ProjectTree.toggled("c", in: ["a"]), ["a", "c"])
        XCTAssertEqual(ProjectTree.toggled("a", in: ["a"]), [])
    }
}
