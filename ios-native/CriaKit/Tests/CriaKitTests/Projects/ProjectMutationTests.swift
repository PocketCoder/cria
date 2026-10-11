import XCTest
@testable import CriaKit

final class ProjectMutationTests: XCTestCase {
    func testCreateAppendsAndQueuesCreate() throws {
        let store = try makeStore()
        try seedProject(store, serverId: 1, title: "First")
        let created = try store.createProject(ProjectInput(title: "Second", hexColor: "ff0000"))

        XCTAssertNil(created.serverId)
        XCTAssertEqual(created.hexColor, "ff0000")
        // Unpositioned (synced) projects sort after positioned ones, so the new project lists first.
        let stored = try XCTUnwrap(try store.project(localId: created.localId))
        XCTAssertEqual(stored.position, 1024)
        XCTAssertEqual(Set(try store.projects().map(\.title)), ["First", "Second"])
        let entries = try outboxEntries(store, entity: "project")
        XCTAssertEqual(entries.map(\.operation), ["create"])
        XCTAssertEqual(try payloadObject(entries[0])["title"] as? String, "Second")
    }

    func testUpdateChangesFieldsAndQueuesFullObject() throws {
        let store = try makeStore()
        let created = try store.createProject(ProjectInput(title: "Old", description: "keep", hexColor: "00ff00"))
        var patch = ProjectPatch(title: "New")
        patch.hexColor = .set(nil)
        let updated = try store.updateProject(localId: created.localId, patch: patch)

        XCTAssertEqual(updated.title, "New")
        XCTAssertNil(updated.hexColor)
        XCTAssertEqual(updated.description, "keep")
        let entries = try outboxEntries(store, entity: "project")
        XCTAssertEqual(entries.map(\.operation), ["create", "update"])
        let payload = try payloadObject(entries[1])
        XCTAssertEqual(payload["title"] as? String, "New")
        XCTAssertEqual(payload["description"] as? String, "keep")
    }

    func testUpdateUnknownProjectThrows() throws {
        let store = try makeStore()
        XCTAssertThrowsError(try store.updateProject(localId: "missing", patch: ProjectPatch(title: "x")))
    }

    func testDeleteHidesProjectAndItsTasksAndQueuesDelete() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        _ = try store.createTask(TaskInput(title: "inside", projectLocalId: project))
        try store.deleteProject(localId: project)

        XCTAssertEqual(try store.projects(), [])
        XCTAssertEqual(try store.tasks(matching: TaskQuery()), [])
        XCTAssertEqual(try outboxEntries(store, entity: "project").map(\.operation), ["delete"])
    }

    func testMutationsAnnounceOnTheBus() async throws {
        let store = try makeStore()
        let stream = store.bus.subscribe()
        let collector = Task { () -> [ChangeKind] in
            var kinds: [ChangeKind] = []
            for await kind in stream {
                kinds.append(kind)
                if kinds.count == 2 { break }
            }
            return kinds
        }
        _ = try store.createProject(ProjectInput(title: "Ping"))
        let kinds = await collector.value
        XCTAssertEqual(Set(kinds), [.projects, .outbox])
    }
}
