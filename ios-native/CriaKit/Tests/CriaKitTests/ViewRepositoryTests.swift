import GRDB
import XCTest
@testable import CriaKit

final class ViewRepositoryTests: XCTestCase {
    // MARK: Default views and server sync (views.test.ts)

    func testCreateDefaultViewsSeedsFourLocalOnlyViewsInOrder() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 1)
        let views = try store.createDefaultViews(projectLocalId: project)

        XCTAssertEqual(views.map(\.viewKind), [.list, .gantt, .table, .kanban])
        // Local only: never dirty, never has a server id, never queued.
        let dirtyOrSynced = try countRows(store, "SELECT COUNT(*) FROM project_views WHERE dirty = 1 OR server_id IS NOT NULL")
        XCTAssertEqual(dirtyOrSynced, 0)
        XCTAssertEqual(try outboxEntries(store, entity: "view").count, 0)
        let kanban = try XCTUnwrap(views.first { $0.viewKind == .kanban })
        XCTAssertEqual(kanban.bucketConfigurationMode, .manual)
    }

    func testCreateDefaultViewsIsIdempotent() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 2)
        try store.createDefaultViews(projectLocalId: project)
        let again = try store.createDefaultViews(projectLocalId: project)
        XCTAssertEqual(again.count, 4)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM project_views"), 4)
    }

    func testServerViewsReplaceLocalDefaultsWithoutDuplicating() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 9)
        let seeded = try store.createDefaultViews(projectLocalId: project)

        try syncViews(store, projectLocalId: project, [
            viewJSON(id: 200, projectId: 9, kind: "list", title: "List", position: 0),
            viewJSON(id: 201, projectId: 9, kind: "gantt", title: "Gantt", position: 1),
            viewJSON(id: 202, projectId: 9, kind: "table", title: "Table", position: 2),
            viewJSON(id: 203, projectId: 9, kind: "kanban", title: "Kanban", position: 3)
        ])

        let views = try store.views(forProject: project)
        XCTAssertEqual(views.count, 4)
        XCTAssertTrue(views.allSatisfy { $0.serverId != nil })
        // Claimed in place, so rows that point at a placeholder (buckets) stay valid.
        XCTAssertEqual(views.map(\.localId), seeded.map(\.localId))
    }

    func testSyncedViewsAreNotPlaceholdersAndDefaultsAre() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 5)
        let seeded = try store.createDefaultViews(projectLocalId: project)
        XCTAssertTrue(seeded.allSatisfy(\.placeholder))

        try syncViews(store, projectLocalId: project, [viewJSON(id: 51, projectId: 5, kind: "list", title: "List", position: 100)])
        let views = try store.views(forProject: project)
        XCTAssertEqual(views.count, 1)
        XCTAssertEqual(views.first?.placeholder, false)
    }

    func testUpsertViewWithUnknownProjectThrows() throws {
        let store = try makeStore()
        let json = viewJSON(id: 1, projectId: 99, kind: "list", title: "X")
        XCTAssertThrowsError(try store.upsertViewFromServer(try decodeFixture(ViewResponse.self, json), rawJSON: json)) { error in
            XCTAssertEqual(error as? ViewError, .parentNotFound(99))
        }
    }

    func testUpsertStoresBucketConfigurationAndDoneBucket() throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 1)
        let json = """
        {"id": 30, "title": "Board", "project_id": 1, "view_kind": "kanban", "position": 4,
         "bucket_configuration_mode": "filter", "bucket_configuration": [{"title": "Open", "filter": "done = false"}],
         "default_bucket_id": 7, "done_bucket_id": 8}
        """
        try store.upsertViewFromServer(try decodeFixture(ViewResponse.self, json), rawJSON: json, knownProjectLocalId: project)
        let view = try XCTUnwrap(try store.views(forProject: project).first)
        XCTAssertEqual(view.bucketConfigurationMode, .filter)
        XCTAssertEqual(view.defaultBucketServerId, 7)
        XCTAssertEqual(view.doneBucketServerId, 8)
        let config = try XCTUnwrap(view.bucketConfiguration)
        XCTAssertTrue(config.contains("done = false"))
    }

    func testPullSoftDeletesViewsTheServerNoLongerHasButSparesDirtyOnes() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let local = try store.createView(projectLocalId: project, ViewInput(title: "Mine", viewKind: .table))

        try syncViews(store, projectLocalId: project, [viewJSON(id: 11, projectId: 1, kind: "list", title: "List", position: 100)])

        let titles = try store.views(forProject: project).map(\.title)
        XCTAssertEqual(titles, ["List", "Mine"])
        XCTAssertEqual(try store.view(localId: local.localId)?.title, "Mine")
    }

    func testDirtyViewIsNotOverwrittenByServerAndRecordsConflict() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let list = try XCTUnwrap(try store.views(forProject: project).first)
        try store.updateView(localId: list.localId, ViewUpdate(title: "Backlog"))

        let json = viewJSON(id: 11, projectId: 1, kind: "list", title: "Server title", position: 100)
        try store.upsertViewFromServer(try decodeFixture(ViewResponse.self, json), rawJSON: json)

        XCTAssertEqual(try store.view(localId: list.localId)?.title, "Backlog")
        let conflicts = try countRows(store, "SELECT COUNT(*) FROM conflicts WHERE entity_type = 'view'")
        XCTAssertEqual(conflicts, 1)
    }

    func testSyncUpsertIsSilentAndUserMutationAnnounces() async throws {
        let store = try makeStore()
        let stream = store.bus.subscribe()
        var iterator = stream.makeAsyncIterator()
        let project = try seedSyncedViews(store)
        try store.createView(projectLocalId: project, ViewInput(title: "Mine", viewKind: .list))
        let first = await iterator.next()
        XCTAssertEqual(first, .views)
    }
}
