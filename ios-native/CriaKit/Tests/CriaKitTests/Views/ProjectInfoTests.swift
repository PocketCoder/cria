import XCTest
@testable import CriaKit

final class ProjectInfoTests: XCTestCase {
    func testTaskCountsSplitOpenAndDoneAndSkipDeleted() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let other = try seedProject(store, serverId: 2, title: "Other")
        _ = try store.createTask(TaskInput(title: "One", projectLocalId: project))
        _ = try store.createTask(TaskInput(title: "Two", projectLocalId: project))
        let finished = try store.createTask(TaskInput(title: "Three", projectLocalId: project))
        _ = try store.updateTask(localId: finished.localId, patch: TaskPatch(done: true))
        let removed = try store.createTask(TaskInput(title: "Gone", projectLocalId: project))
        try store.deleteTask(localId: removed.localId)
        _ = try store.createTask(TaskInput(title: "Elsewhere", projectLocalId: other))

        XCTAssertEqual(try store.taskCounts(forProject: project), ProjectTaskCounts(open: 2, done: 1))
        XCTAssertEqual(try store.taskCounts(forProject: "missing"), ProjectTaskCounts(open: 0, done: 0))
    }

    func testAssigneesByTaskGroupsOnePerTask() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let first = try store.createTask(TaskInput(title: "A", projectLocalId: project))
        let second = try store.createTask(TaskInput(title: "B", projectLocalId: project))
        _ = try store.createTask(TaskInput(title: "C", projectLocalId: project))
        try store.addAssignee(taskLocalId: first.localId, userId: 5, username: "sam")
        try store.addAssignee(taskLocalId: first.localId, userId: 6, username: "alex")
        try store.addAssignee(taskLocalId: second.localId, userId: 5, username: "sam")

        let byTask = try store.assigneesByTask(projectLocalId: project)
        XCTAssertEqual(byTask[first.localId]?.compactMap(\.username), ["alex", "sam"])
        XCTAssertEqual(byTask[second.localId]?.map(\.userId), [5])
        XCTAssertEqual(byTask.count, 2)
    }

    func testServerInfoReadsOwnerAndIgnoresTheNoDateSentinel() throws {
        let info = try decodeFixture(ProjectServerInfo.self, """
            {"id": 1, "owner": {"id": 2, "name": "Sam Jones", "username": "sam"}, "created": "2026-03-01T09:00:00Z"}
            """)
        XCTAssertEqual(info, ProjectServerInfo(ownerName: "Sam Jones", created: "2026-03-01T09:00:00Z"))

        let fallback = try decodeFixture(ProjectServerInfo.self, """
            {"owner": {"name": "", "username": "sam"}, "created": "0001-01-01T00:00:00Z"}
            """)
        XCTAssertEqual(fallback, ProjectServerInfo(ownerName: "sam", created: nil))

        let bare = try decodeFixture(ProjectServerInfo.self, "{}")
        XCTAssertEqual(bare, ProjectServerInfo(ownerName: nil, created: nil))
    }

    func testDuplicateNeedsASyncedProject() async throws {
        let store = try makeStore()
        let local = try store.createProject(ProjectInput(title: "Draft"))
        let blobs = FileManager.default.temporaryDirectory.appendingPathComponent("blobs-\(UUID().uuidString)")
        let services = await AppServices(api: ApiClient(serverURL: "https://v.example.com/"), store: store, blobDirectory: blobs)
        do {
            try await services.duplicateProject(localId: local.localId)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? ProjectOnlineError, .notSynced)
        }
    }
}
