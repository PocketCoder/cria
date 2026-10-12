import XCTest
@testable import CriaKit

/// The table's Created By and Comments columns.
final class TableExtrasTests: XCTestCase {
    override func setUp() {
        super.setUp()
        ExpandSupport.shared.reset()
    }

    private func creatorJSON(id: Int, creator: String) -> String {
        """
        {"id": \(id), "project_id": 1, "title": "Task \(id)", "updated": "2026-06-09T10:00:00Z", "created_by": \(creator)}
        """
    }

    private func upsert(_ store: CriaStore, _ json: String) throws -> TaskRecord {
        let localId = try XCTUnwrap(store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        return try XCTUnwrap(store.task(localId: localId))
    }

    // MARK: Created by

    func testCreatorIsReadAndNamed() throws {
        let store = try makeStore()
        try seedProject(store)
        let named = try upsert(store, creatorJSON(id: 1, creator: #"{"id": 90101, "username": "sam", "name": "Sam Smith"}"#))
        let bare = try upsert(store, creatorJSON(id: 2, creator: #"{"id": 90102, "username": "jo", "name": ""}"#))
        let unseen = try upsert(store, creatorJSON(id: 3, creator: #"{"id": 90103}"#))
        let mine = try upsert(store, creatorJSON(id: 4, creator: #"{"id": 90104, "username": "me"}"#))
        let local = try store.createTask(TaskInput(title: "Here", projectLocalId: named.projectLocalId))

        XCTAssertEqual(named.createdById, 90101)
        let extras = TableExtras(currentUserId: 90104)
        XCTAssertEqual(extras.createdBy(named), "Sam Smith")
        XCTAssertEqual(extras.createdBy(bare), "jo", "username when there is no name")
        XCTAssertEqual(extras.createdBy(unseen), "#90103")
        XCTAssertEqual(extras.createdBy(mine), "You")
        XCTAssertNil(extras.createdBy(local), "unknown for a task made here")
        XCTAssertEqual(TableCells.text(mine, .createdBy, projectTitle: nil, now: Date(), extras: extras), "You")
    }

    func testDirectoryRemembersUsernames() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "usernames-\(UUID().uuidString)"))
        let directory = UserNameDirectory(defaults: defaults)
        directory.remember([(5, nil)], usernames: [(5, "kim"), (6, " ")])
        XCTAssertNil(directory.name(for: 5))
        XCTAssertEqual(directory.username(for: 5), "kim")
        XCTAssertNil(directory.username(for: 6))
        XCTAssertEqual(UserNameDirectory(defaults: defaults).username(for: 5), "kim", "persists")
        directory.forget()
        XCTAssertNil(UserNameDirectory(defaults: defaults).username(for: 5))
    }

    func testSortsByShownCreatorAndCommentCount() throws {
        let store = try makeStore()
        try seedProject(store)
        let zed = try upsert(store, creatorJSON(id: 1, creator: #"{"id": 90201, "name": "Zed"}"#))
        let amy = try upsert(store, creatorJSON(id: 2, creator: #"{"id": 90202, "name": "Amy"}"#))
        let you = try upsert(store, creatorJSON(id: 3, creator: #"{"id": 90203}"#))
        let extras = TableExtras(currentUserId: 90203, commentCounts: [1: 4, 3: 1])
        let all = Set(TableViewColumn.allCases)

        let byCreator = TableSort.sorted(
            [zed, amy, you], keys: [TableSortKey(column: .createdBy, direction: .asc)], visible: all, extras: extras
        )
        XCTAssertEqual(byCreator.map(\.serverId), [2, 3, 1], "Amy, You, Zed")

        let byComments = TableSort.sorted(
            [zed, amy, you], keys: [TableSortKey(column: .commentCount, direction: .desc)], visible: all, extras: extras
        )
        XCTAssertEqual(byComments.map(\.serverId), [1, 3, 2], "unknown count last")
        XCTAssertEqual(TableCells.text(amy, .commentCount, projectTitle: nil, now: Date(), extras: extras), nil)
        XCTAssertEqual(TableCells.text(zed, .commentCount, projectTitle: nil, now: Date(), extras: extras), "4")
    }

    func testNewColumnsAreOffByDefaultAndStoredConfigsStillLoad() {
        XCTAssertFalse(TableViewColumn.defaultVisible.contains(.createdBy))
        XCTAssertFalse(TableViewColumn.defaultVisible.contains(.commentCount))
        XCTAssertEqual(TableConfigCodec.decodeColumns("index,title,dueDate"), [.index, .title, .dueDate])
        XCTAssertEqual(TableConfigCodec.decodeColumns("title,createdBy,commentCount,bogus"), [.title, .createdBy, .commentCount])
        let encoded = TableConfigCodec.encodeColumns([.commentCount, .createdBy])
        XCTAssertEqual(TableConfigCodec.decodeColumns(encoded), [.commentCount, .createdBy])
        XCTAssertEqual(TableConfigCodec.decodeSort("commentCount:desc"), [TableSortKey(column: .commentCount, direction: .desc)])
        XCTAssertTrue(TableViewColumn.createdBy.sortable)
        XCTAssertTrue(TableViewColumn.commentCount.sortable)
        XCTAssertEqual(TableSort.defaultDirection(for: .createdBy), .asc)
        XCTAssertEqual(TableCells.sortSummary([TableSortKey(column: .createdBy, direction: .asc)]), "Created By, A to Z")
    }

    // MARK: Comment counts

    private func api(_ server: StubServer) -> ApiClient {
        let session = FakeSession(serverURL: "https://counts-\(UUID().uuidString).example")
        return ApiClient(session: session, core: HTTPCore(transport: server.transport))
    }

    /// A project with the default views (table is view 13), tasks 1 to 3, and one synced comment on task 2.
    private func seededStore() throws -> (store: CriaStore, project: String) {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        for id in 1...3 { try seedSyncedTask(store, serverId: id) }
        let task2 = try XCTUnwrap(store.tasks(matching: TaskQuery(projectLocalId: project)).first { $0.serverId == 2 })
        try runSQL(store, """
            INSERT INTO task_comments (local_id, server_id, task_local_id, comment, dirty, deleted)
            VALUES ('c1', 50, ?, 'Hi', 0, 0), ('c2', 0, ?, 'Pending', 1, 0), ('c3', 51, ?, 'Gone', 0, 1)
            """, [task2.localId, task2.localId, task2.localId])
        return (store, project)
    }

    func testCountsComeFromTheViewTasksWithExpand() async throws {
        let (store, project) = try seededStore()
        let server = StubServer()
        server.json("GET /projects/1/views/13/tasks", #"[{"id": 1, "comment_count": 3}, {"id": 3, "comment_count": 0}]"#)
        let result = await TableCommentCounts.load(api: api(server), store: store, projectLocalId: project, viewLocalId: nil)

        XCTAssertTrue(result.fromServer)
        XCTAssertEqual(result.counts, [1: 3, 2: 1, 3: 0], "task 2 missing from the view keeps its local count")
        let query = server.requests.first?.url?.query ?? ""
        XCTAssertTrue(query.contains("expand=comment_count"), query)
        XCTAssertTrue(query.contains("page=1"), query)
    }

    func testRejectedExpandFallsBackToLocalCountsAndIsNotRetried() async throws {
        let (store, project) = try seededStore()
        let server = StubServer()
        server.json(
            "GET /projects/1/views/13/tasks", #"{"code": 2002, "message": "Expand must be one of the following values"}"#, status: 400
        )
        let client = api(server)
        let first = await TableCommentCounts.load(api: client, store: store, projectLocalId: project, viewLocalId: nil)
        XCTAssertFalse(first.fromServer)
        XCTAssertEqual(first.counts, [2: 1], "only synced, live comments count")

        let second = await TableCommentCounts.load(api: client, store: store, projectLocalId: project, viewLocalId: nil)
        XCTAssertEqual(second.counts, [2: 1])
        XCTAssertEqual(server.requests.count, 1, "the server is not asked again this session")
    }

    func testOfflineFallsBackToLocalCounts() async throws {
        let (store, project) = try seededStore()
        let transport = StubTransport { _, _ in throw URLError(.notConnectedToInternet) }
        let client = ApiClient(session: FakeSession(serverURL: "https://offline.example"), core: HTTPCore(transport: transport))
        let result = await TableCommentCounts.load(api: client, store: store, projectLocalId: project, viewLocalId: nil)
        XCTAssertEqual(result, TableCommentCounts(counts: [2: 1], fromServer: false))
    }

    func testGivenViewIsUsedAndKanbanIsSkipped() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let views = try store.views(forProject: project)
        let list = try XCTUnwrap(views.first { $0.viewKind == .list })
        let kanban = try XCTUnwrap(views.first { $0.viewKind == .kanban })
        XCTAssertEqual(try store.commentCountRoute(projectLocalId: project, viewLocalId: list.localId)?.view, 11)
        XCTAssertEqual(try store.commentCountRoute(projectLocalId: project, viewLocalId: kanban.localId)?.view, 13)
        XCTAssertEqual(try store.commentCountRoute(projectLocalId: project, viewLocalId: nil)?.project, 1)
    }
}
