import GRDB
import XCTest
@testable import CriaKit

/// The outbox executors against a simulated v1 and a simulated v2 server: same local result, each version's own
/// verbs and paths on the wire.
final class VersionedExecutorTests: XCTestCase {
    private struct Flavour {
        let version: ApiVersion
        let create: String
        let update: String
        var prefix: String { version.basePath }
    }

    private let flavours = [
        Flavour(version: .apiV1, create: "PUT", update: "POST"),
        Flavour(version: .apiV2, create: "POST", update: "PUT")
    ]

    private func drain(_ store: CriaStore, _ server: StubServer, _ flavour: Flavour) async {
        let drainer = OutboxDrainer(api: server.api(version: flavour.version), store: store)
        await drainer.registerStandardExecutors()
        await drainer.drain()
    }

    private func sent(_ server: StubServer) -> [String] {
        server.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
    }

    func testTaskCreateUpdateDeleteOnBothVersions() async throws {
        for flavour in flavours {
            let store = try makeStore()
            let project = try seedProject(store, serverId: 1)
            let server = StubServer()
            let created = #"{"id": 55, "project_id": 1, "title": "New", "updated": "2026-06-09T10:00:00Z"}"#
            server.json("\(flavour.create) /projects/1/tasks", created, status: flavour.version == .apiV2 ? 201 : 200)
            server.json("GET /tasks/55", created)
            server.json(
                "\(flavour.update) /tasks/55",
                #"{"id": 55, "project_id": 1, "title": "Renamed", "updated": "2026-06-11T10:00:00Z"}"#
            )
            server.json("DELETE /tasks/55", "", status: flavour.version == .apiV2 ? 204 : 200)

            let task = try store.createTask(TaskInput(title: "New", projectLocalId: project))
            await drain(store, server, flavour)
            XCTAssertEqual(try store.task(localId: task.localId)?.serverId, 55, "\(flavour.version)")
            XCTAssertTrue(sent(server).contains("\(flavour.create) \(flavour.prefix)/projects/1/tasks"), "\(sent(server))")
            let createBody = try body(try XCTUnwrap(server.requests.first))
            XCTAssertEqual(createBody["is_favorite"] as? Bool, false, "wire quirks survive on \(flavour.version)")
            XCTAssertEqual(createBody["repeat_after"] as? Int, 0)

            try store.updateTask(localId: task.localId, patch: TaskPatch(title: "Renamed"))
            await drain(store, server, flavour)
            let update = try XCTUnwrap(server.requests.last { $0.httpMethod == flavour.update })
            XCTAssertEqual(update.url?.path, "\(flavour.prefix)/tasks/55")
            XCTAssertEqual(try body(update)["title"] as? String, "Renamed")
            XCTAssertEqual(try body(update)["project_id"] as? Int, 1, "a PUT carries the whole task, project included")

            try store.deleteTask(localId: task.localId)
            await drain(store, server, flavour)
            XCTAssertTrue(sent(server).contains("DELETE \(flavour.prefix)/tasks/55"))
            XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 0)
            XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM outbox"), 0)
        }
    }

    func testProjectFavouriteAndDeleteOnBothVersions() async throws {
        for flavour in flavours {
            let store = try makeStore()
            let local = try seedProject(store, serverId: 4, title: "Work")
            let server = StubServer()
            server.json("\(flavour.update) /projects/4", #"{"id": 4, "title": "Work", "updated": "2026-06-11T10:00:00Z"}"#)
            server.json("DELETE /projects/4", "", status: flavour.version == .apiV2 ? 204 : 200)
            try store.setProjectFavorite(localId: local, isFavorite: true)
            await drain(store, server, flavour)
            let request = try XCTUnwrap(server.requests.last { $0.httpMethod == flavour.update })
            XCTAssertEqual(request.url?.path, "\(flavour.prefix)/projects/4")
            XCTAssertEqual(try body(request)["is_favorite"] as? Bool, true)
            XCTAssertEqual(try body(request)["title"] as? String, "Work")

            try enqueueRaw(store, .project, localId: local, op: .delete)
            await drain(store, server, flavour)
            XCTAssertTrue(sent(server).contains("DELETE \(flavour.prefix)/projects/4"))
            XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects"), 0)
        }
    }

    func testLabelCreateOnBothVersionsKeepsHexWithoutHash() async throws {
        for flavour in flavours {
            let store = try makeStore()
            let local = UUID().uuidString
            try runSQL(store, """
                INSERT INTO labels (local_id, title, hex_color, updated_at, dirty, deleted)
                VALUES (?, 'Home', '#00ff00', '2026-01-01T00:00:00Z', 1, 0)
                """, [local])
            try enqueueRaw(store, .label, localId: local, op: .create)
            let server = StubServer()
            server.json("\(flavour.create) /labels", #"{"id": 12, "title": "Home", "updated": "2026-06-11T10:00:00Z"}"#,
                        status: flavour.version == .apiV2 ? 201 : 200)
            await drain(store, server, flavour)
            XCTAssertEqual(try store.labels().first?.serverId, 12, "\(flavour.version)")
            let request = try XCTUnwrap(server.requests.first)
            XCTAssertEqual(request.httpMethod, flavour.create)
            XCTAssertEqual(request.url?.path, "\(flavour.prefix)/labels")
            XCTAssertEqual(try body(request)["hex_color"] as? String, "00ff00")
        }
    }

    func testV2ValidationErrorIsPermanentNotRetried() async throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 1)
        let server = StubServer()
        server.json(
            "POST /projects/1/tasks",
            #"{"title": "Unprocessable Entity", "status": 422, "detail": "bad", "code": 4001}"#,
            status: 422
        )
        _ = try store.createTask(TaskInput(title: "New", projectLocalId: project))
        await drain(store, server, Flavour(version: .apiV2, create: "POST", update: "PUT"))
        XCTAssertEqual(server.requests.count, 1)
        XCTAssertEqual(try store.deadLetters().count, 1, "a 422 will never succeed: it is parked, not retried")
    }
}
