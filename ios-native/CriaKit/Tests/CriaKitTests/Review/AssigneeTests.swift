import GRDB
import XCTest
@testable import CriaKit

final class AssigneeTests: XCTestCase {
    private func assigneeOps(_ store: CriaStore) throws -> [String] {
        try outboxRows(store).filter { $0["entity_type"] as String? == "task_assignee" }.map { $0["op"] as String? ?? "" }
    }

    func testQuickAddQueuesOneOpPerDistinctAssignee() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        try store.persistQuickAdd(
            TaskInput(title: "Ship", projectLocalId: project), labelTitles: [], assigneeUsernames: ["sam", "@Sam", " ann ", ""]
        )
        XCTAssertEqual(try assigneeOps(store), ["add", "add"])
    }

    func testNoAssigneesQueuesNothing() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        try store.persistQuickAdd(TaskInput(title: "Solo", projectLocalId: project), labelTitles: [])
        XCTAssertTrue(try assigneeOps(store).isEmpty)
    }

    private func runOp(users: String) async throws -> [String] {
        let store = try makeStore()
        try seedProject(store)
        let json = taskJSON(id: 5, title: "Task")
        let local = try XCTUnwrap(store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        try store.queueAssignees(["sam"], toTask: local)
        let head = try XCTUnwrap(store.outboxHead())
        let transport = StubTransport { request, _ in
            let path = request.url?.path ?? ""
            return (200, path.hasSuffix("/users") ? users : "{}", ["Content-Type": "application/json"])
        }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        try await TaskLinkExecutor().execute(head, api: api, store: store)
        return transport.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
    }

    func testExecutorResolvesTheUsernameThenAssigns() async throws {
        let calls = try await runOp(users: #"[{"id": 8, "username": "samuel"}, {"id": 7, "username": "Sam"}]"#)
        XCTAssertEqual(calls, ["GET /api/v1/users", "PUT /api/v1/tasks/5/assignees"])
    }

    func testUnknownUsernameIsDropped() async throws {
        let calls = try await runOp(users: #"[{"id": 8, "username": "samuel"}]"#)
        XCTAssertEqual(calls, ["GET /api/v1/users"])
    }
}
