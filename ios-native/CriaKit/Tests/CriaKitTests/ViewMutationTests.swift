import GRDB
import XCTest
@testable import CriaKit

final class ViewMutationTests: XCTestCase {
    // MARK: Mutations (viewMutations.test.ts)

    func testCreateViewPositionsAfterMaxAndQueuesCreate() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)

        let created = try store.createView(projectLocalId: project, ViewInput(title: "Roadmap", viewKind: .gantt))
        XCTAssertEqual(created.position, 400 + 1024)
        XCTAssertEqual(created.bucketConfigurationMode, BucketMode.none)
        XCTAssertNil(created.serverId)
        XCTAssertFalse(created.placeholder, "a pending create is not a placeholder")
        XCTAssertEqual(try store.views(forProject: project).last?.localId, created.localId)

        let entries = try outboxEntries(store, entity: "view")
        XCTAssertEqual(entries.map(\.localId), [created.localId])
        XCTAssertEqual(entries.map(\.operation), ["create"])
        let payload = try payloadObject(try XCTUnwrap(entries.first))
        XCTAssertEqual(payload["title"] as? String, "Roadmap")
        XCTAssertEqual(payload["viewKind"] as? String, "gantt")
    }

    func testNewKanbanViewDefaultsToManualBuckets() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let created = try store.createView(projectLocalId: project, ViewInput(title: "Board 2", viewKind: .kanban))
        XCTAssertEqual(created.bucketConfigurationMode, .manual)
    }

    func testRenameQueuesUpdate() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let list = try XCTUnwrap(try store.views(forProject: project).first)

        let renamed = try store.updateView(localId: list.localId, ViewUpdate(title: "Backlog"))
        XCTAssertEqual(renamed.title, "Backlog")
        let entries = try outboxEntries(store, entity: "view")
        XCTAssertEqual(entries.map(\.operation), ["update"])
        XCTAssertEqual(entries.map(\.localId), [list.localId])
    }

    func testMidpointReorderIsASinglePositionUpdate() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let kanban = try XCTUnwrap(try store.views(forProject: project).first { $0.viewKind == .kanban })

        try store.updateView(localId: kanban.localId, ViewUpdate(position: 150))

        XCTAssertEqual(try store.views(forProject: project).map(\.viewKind), [.list, .kanban, .gantt, .table])
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 1)
    }

    func testUpdateCanSetAndClearNullableFields() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let kanban = try XCTUnwrap(try store.views(forProject: project).first { $0.viewKind == .kanban })

        let set = try store.updateView(localId: kanban.localId, ViewUpdate(doneBucketServerId: .some(808)))
        XCTAssertEqual(set.doneBucketServerId, 808)
        XCTAssertNil(set.defaultBucketServerId)

        let cleared = try store.updateView(localId: kanban.localId, ViewUpdate(doneBucketServerId: .some(nil)))
        XCTAssertNil(cleared.doneBucketServerId)
    }

    func testReindexRewritesEveryPositionInOrder() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let reversed = try store.views(forProject: project).map(\.localId).reversed().map { $0 }

        try store.reindexViews(reversed)

        let after = try store.views(forProject: project)
        XCTAssertEqual(after.map(\.localId), reversed)
        XCTAssertEqual(after.map(\.position), [1024, 2048, 3072, 4096])
        let entries = try outboxEntries(store, entity: "view")
        XCTAssertEqual(entries.map(\.localId), reversed)
        XCTAssertTrue(entries.allSatisfy { $0.operation == "update" })
    }

    func testReindexWithNoIdsIsANoOp() throws {
        let store = try makeStore()
        try store.reindexViews([])
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 0)
    }

    func testDeleteSoftDeletesAndQueuesDelete() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let gantt = try XCTUnwrap(try store.views(forProject: project).first { $0.viewKind == .gantt })

        try store.deleteView(localId: gantt.localId)

        XCTAssertEqual(try store.views(forProject: project).map(\.viewKind), [.list, .table, .kanban])
        let entries = try outboxEntries(store, entity: "view")
        XCTAssertEqual(entries.map(\.localId), [gantt.localId])
        XCTAssertEqual(entries.map(\.operation), ["delete"])
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM project_views WHERE local_id = ? AND deleted = 1", [gantt.localId]), 1)
    }

    func testDeleteRefusesTheLastView() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 2)
        try syncViews(store, projectLocalId: project, [viewJSON(id: 21, projectId: 2, kind: "list", title: "List", position: 100)])
        let only = try XCTUnwrap(try store.views(forProject: project).first)

        XCTAssertThrowsError(try store.deleteView(localId: only.localId)) { error in
            XCTAssertEqual(error as? ViewError, .lastView)
        }
        XCTAssertEqual(try store.views(forProject: project).count, 1)
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 0)
    }

    func testDeleteOfUnknownViewIsANoOp() throws {
        let store = try makeStore()
        try store.deleteView(localId: "does-not-exist")
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 0)
    }

    // MARK: Placeholder guard

    func testPlaceholderRefusesEveryKindOfEditWritingNothing() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 4)
        let seeded = try store.createDefaultViews(projectLocalId: project)
        let target = try XCTUnwrap(seeded.first { $0.viewKind == .kanban })
        let edits = [
            ViewUpdate(title: "Backlog"),
            ViewUpdate(position: 5),
            ViewUpdate(filter: .some("done = false")),
            ViewUpdate(doneBucketServerId: .some(808)),
            ViewUpdate(defaultBucketServerId: .some(808))
        ]
        for edit in edits {
            XCTAssertThrowsError(try store.updateView(localId: target.localId, edit)) { error in
                XCTAssertEqual(error as? ViewError, .placeholder)
            }
        }
        XCTAssertEqual(try store.view(localId: target.localId), target)
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 0)
    }

    func testPlaceholderRefusesReindexAndDeleteWritingNothing() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 4)
        let seeded = try store.createDefaultViews(projectLocalId: project)

        XCTAssertThrowsError(try store.reindexViews(seeded.map(\.localId).reversed().map { $0 })) { error in
            XCTAssertEqual(error as? ViewError, .placeholder)
        }
        XCTAssertEqual(try store.views(forProject: project).map(\.position), [0, 1, 2, 3])

        let first = try XCTUnwrap(seeded.first)
        XCTAssertThrowsError(try store.deleteView(localId: first.localId)) { error in
            XCTAssertEqual(error as? ViewError, .placeholder)
        }
        XCTAssertEqual(try store.views(forProject: project).count, 4)
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 0)
    }

    func testPendingLocalCreateCanStillBeEditedAndDeleted() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let created = try store.createView(projectLocalId: project, ViewInput(title: "Mine", viewKind: .list))

        try store.updateView(localId: created.localId, ViewUpdate(title: "Renamed"))
        XCTAssertEqual(try store.view(localId: created.localId)?.title, "Renamed")
        XCTAssertEqual(try outboxEntries(store, entity: "view").map(\.operation), ["create", "update"])

        try store.deleteView(localId: created.localId)
        XCTAssertNil(try store.view(localId: created.localId))
    }

    func testClaimedPlaceholdersBecomeEditable() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 9)
        let seeded = try store.createDefaultViews(projectLocalId: project)
        XCTAssertThrowsError(try store.updateView(localId: seeded[0].localId, ViewUpdate(filter: .some("done = false"))))

        try syncViews(store, projectLocalId: project, [
            viewJSON(id: 91, projectId: 9, kind: "list", title: "List", position: 100),
            viewJSON(id: 92, projectId: 9, kind: "gantt", title: "Gantt", position: 200),
            viewJSON(id: 93, projectId: 9, kind: "table", title: "Table", position: 300),
            viewJSON(id: 94, projectId: 9, kind: "kanban", title: "Kanban", position: 400)
        ])

        let views = try store.views(forProject: project)
        XCTAssertEqual(views.map(\.serverId), [91, 92, 93, 94])
        XCTAssertTrue(views.allSatisfy { !$0.placeholder })
        try store.updateView(localId: views[0].localId, ViewUpdate(title: "Backlog"))
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 1)
    }
}

/// Disambiguates `.none` from `Optional.none` in assertions.
private typealias BucketMode = ViewResponse.BucketConfigMode
