import GRDB
import XCTest
@testable import CriaKit

/// Pull-time conflicts on projects and labels: detection on every user-editable field, and both resolutions.
final class ProjectLabelConflictTests: XCTestCase {
    private func projectJSON(
        title: String = "Work", description: String = "", color: String = "e8e8e8", parent: Int = 0,
        archived: Bool = false, favourite: Bool = false, updated: String = "2026-01-01T00:00:00Z"
    ) -> String {
        """
        {"id": 5, "title": "\(title)", "description": "\(description)", "hex_color": "\(color)", \
        "parent_project_id": \(parent), "is_archived": \(archived), "is_favorite": \(favourite), \
        "identifier": "WRK", "position": 10, "updated": "\(updated)"}
        """
    }

    private func labelJSON(title: String = "Urgent", description: String = "", color: String = "e8e8e8") -> String {
        #"{"id": 7, "title": "\#(title)", "description": "\#(description)", "hex_color": "\#(color)", "updated": "2026-01-01T00:00:00Z"}"#
    }

    @discardableResult
    private func pullProject(_ store: CriaStore, _ json: String) throws -> String {
        try XCTUnwrap(try store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json))
    }

    @discardableResult
    private func pullLabel(_ store: CriaStore, _ json: String) throws -> String {
        try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, json), rawJSON: json)
    }

    /// A synced project (with a synced parent candidate, server id 2) and a local title edit queued.
    private func editedProject() throws -> (CriaStore, String) {
        let store = try makeStore()
        try seedProject(store, serverId: 2, title: "Parent")
        let localId = try pullProject(store, projectJSON())
        try store.updateProject(localId: localId, patch: ProjectPatch(title: "Mine"))
        return (store, localId)
    }

    /// A synced label with a local title edit (no op queued, as a pull would find it after a crash).
    private func editedLabel() throws -> (CriaStore, String) {
        let store = try makeStore()
        let localId = try pullLabel(store, labelJSON())
        try runSQL(store, "UPDATE labels SET title = 'Mine', dirty = 1 WHERE local_id = ?", [localId])
        return (store, localId)
    }

    private func project(_ store: CriaStore, _ localId: String) throws -> ProjectRecord {
        try XCTUnwrap(try store.project(localId: localId))
    }

    private func label(_ store: CriaStore, _ localId: String) throws -> LabelRecord {
        try XCTUnwrap(try store.labels().first { $0.localId == localId })
    }

    // MARK: Detection

    func testProjectPullRecordsEveryEditableFieldTheServerChanged() throws {
        let (store, localId) = try editedProject()
        try pullProject(store, projectJSON(title: "Theirs", description: "New", color: "ff0000", parent: 2,
                                           archived: true, favourite: true))
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        XCTAssertEqual(conflict.entityType, "project")
        XCTAssertEqual(conflict.entityLocalId, localId)
        XCTAssertEqual(conflict.fields, ["title", "description", "hex_color", "parent_project_id", "is_archived", "is_favorite"])
        XCTAssertEqual(conflict.diff.map(\.label), ["Title", "Description", "Colour", "Parent project", "Archived", "Favourite"])
        XCTAssertEqual(try project(store, localId).title, "Mine", "the pull does not overwrite the edit")
        try pullProject(store, projectJSON(title: "Theirs", description: "New", color: "ff0000", parent: 2,
                                           archived: true, favourite: true))
        XCTAssertEqual(try store.unresolvedConflicts().count, 1, "the same pair of snapshots is recorded once")
    }

    func testLabelPullRecordsAColourChange() throws {
        let (store, localId) = try editedLabel()
        try pullLabel(store, labelJSON(color: "00ff00"))
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        XCTAssertEqual(conflict.entityType, "label")
        XCTAssertEqual(conflict.fields, ["hex_color"])
        XCTAssertEqual(conflict.diff.first?.label, "Colour")
        XCTAssertEqual(try label(store, localId).title, "Mine")
    }

    func testOnlyTheServerChangedOverwritesWithoutAConflict() throws {
        let store = try makeStore()
        let projectId = try pullProject(store, projectJSON())
        let labelId = try pullLabel(store, labelJSON())
        try pullProject(store, projectJSON(title: "Renamed", color: "ff0000", archived: true))
        try pullLabel(store, labelJSON(title: "Renamed"))
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        XCTAssertEqual(try project(store, projectId).title, "Renamed")
        XCTAssertTrue(try project(store, projectId).isArchived)
        XCTAssertEqual(try label(store, labelId).title, "Renamed")
    }

    func testOnlyTheLocalSideChangedKeepsTheEditWithoutAConflict() throws {
        let (store, projectId) = try editedProject()
        try pullProject(store, projectJSON(updated: "2026-01-02T00:00:00Z"))
        let (labelStore, labelId) = try editedLabel()
        try pullLabel(labelStore, labelJSON())
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        XCTAssertTrue(try labelStore.unresolvedConflicts().isEmpty)
        XCTAssertEqual(try project(store, projectId).title, "Mine")
        XCTAssertEqual(try label(labelStore, labelId).title, "Mine")
    }

    func testTheServerEchoingThisDevicesEditIsNotAConflict() throws {
        let (store, localId) = try editedProject()
        try store.setProjectFavorite(localId: localId, isFavorite: true)
        // An earlier push already reached the server: it now has the favourite, the snapshot does not.
        let echoed = projectJSON(favourite: true)
        try pullProject(store, echoed)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        let lastSynced = try store.database.writer.read { connection in
            try String.fetchOne(connection, sql: "SELECT last_synced FROM projects WHERE local_id = ?", arguments: [localId])
        }
        XCTAssertEqual(lastSynced, echoed, "the baseline moves up so the pre-push check does not trip on the echo")
    }

    func testColoursCompareWithoutHashOrCase() throws {
        let store = try makeStore()
        let localId = try pullLabel(store, labelJSON(color: "E8E8E8"))
        try runSQL(store, "UPDATE labels SET title = 'Mine', hex_color = '#00FF00', dirty = 1 WHERE local_id = ?", [localId])
        try pullLabel(store, labelJSON(color: "#e8e8e8"))
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty, "the same colour spelt differently")
        try pullLabel(store, labelJSON(color: "00ff00"))
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty, "the server already has this device's colour")
    }

    func testAPendingDeleteRecordsNoConflict() throws {
        let (store, localId) = try editedProject()
        try store.deleteProject(localId: localId)
        let returned = try store.upsertProjectFromServer(
            try decodeFixture(ProjectResponse.self, projectJSON(title: "Theirs")), rawJSON: projectJSON(title: "Theirs")
        )
        XCTAssertNil(returned)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
    }

    // MARK: Resolution

    func testKeepMineOnAProjectMergesAndQueuesTheUpdate() throws {
        let (store, localId) = try editedProject()
        try runSQL(store, "DELETE FROM outbox")
        let remote = projectJSON(title: "Theirs", color: "ff0000", parent: 2, favourite: true)
        try pullProject(store, remote)
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        try store.resolveConflictKeepMine(id: conflict.id)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        let merged = try project(store, localId)
        XCTAssertEqual(merged.title, "Mine", "the edited field keeps the edit")
        XCTAssertEqual(merged.hexColor, "ff0000", "fields left alone take the server's value")
        XCTAssertTrue(merged.isFavorite)
        XCTAssertNotNil(merged.parentLocalId)
        XCTAssertEqual(try project(store, try XCTUnwrap(merged.parentLocalId)).title, "Parent")
        let ops = try outboxEntries(store, entity: "project")
        XCTAssertEqual(ops.map(\.operation), ["update"])
        let payload = try payloadObject(try XCTUnwrap(ops.first))
        XCTAssertEqual(payload["title"] as? String, "Mine")
        XCTAssertEqual(payload["hex_color"] as? String, "ff0000")
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects WHERE dirty = 1 AND last_synced = ?", [remote]), 1)
    }

    func testKeepMineOnALabelKeepsTheEditAndQueuesTheUpdate() throws {
        let (store, localId) = try editedLabel()
        try pullLabel(store, labelJSON(title: "Theirs", color: "00ff00"))
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        try store.resolveConflictKeepMine(id: conflict.id)
        let merged = try label(store, localId)
        XCTAssertEqual(merged.title, "Mine")
        XCTAssertEqual(merged.hexColor, "00ff00")
        let ops = try outboxEntries(store, entity: "label")
        XCTAssertEqual(ops.map(\.operation), ["update"])
        XCTAssertEqual(try payloadObject(try XCTUnwrap(ops.first))["title"] as? String, "Mine")
    }

    func testUseTheirsOnAProjectAppliesEveryFieldAndClearsTheEdit() throws {
        let (store, localId) = try editedProject()
        try pullProject(store, projectJSON(title: "Theirs", description: "New", color: "ff0000", parent: 2,
                                           archived: true, favourite: true))
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        try store.resolveConflictUseTheirs(id: conflict.id)
        let theirs = try XCTUnwrap(try store.projects().first { $0.localId == localId })
        XCTAssertEqual(theirs.title, "Theirs")
        XCTAssertEqual(theirs.description, "New")
        XCTAssertEqual(theirs.hexColor, "ff0000")
        XCTAssertTrue(theirs.isArchived)
        XCTAssertTrue(theirs.isFavorite)
        XCTAssertEqual(theirs.identifier, "WRK")
        XCTAssertEqual(try project(store, try XCTUnwrap(theirs.parentLocalId)).title, "Parent")
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects WHERE dirty = 1"), 0)
        XCTAssertTrue(try outboxEntries(store, entity: "project").isEmpty)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
    }

    func testUseTheirsOnALabelAppliesTheServerCopy() throws {
        let (store, localId) = try editedLabel()
        try pullLabel(store, labelJSON(title: "Theirs", description: "Server", color: "00ff00"))
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        try store.resolveConflictUseTheirs(id: conflict.id)
        let theirs = try label(store, localId)
        XCTAssertEqual(theirs.title, "Theirs")
        XCTAssertEqual(theirs.description, "Server")
        XCTAssertEqual(theirs.hexColor, "00ff00")
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM labels WHERE dirty = 1"), 0)
    }

    func testConflictDiffShowsTheEditAndParentTitles() throws {
        let (store, _) = try editedProject()
        try pullProject(store, projectJSON(title: "Theirs", parent: 2))
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        let diff = try store.conflictDiff(conflict)
        XCTAssertEqual(diff.map(\.field), ["title", "parent_project_id"])
        XCTAssertEqual(diff.map(\.local), ["Mine", "None"])
        XCTAssertEqual(diff.map(\.remote), ["Theirs", "Parent"])
    }

    // MARK: Push

    private func drain(_ store: CriaStore, _ server: StubServer) async {
        let drainer = OutboxDrainer(api: server.api(), store: store)
        await drainer.registerStandardExecutors()
        await drainer.drain()
    }

    private func lastSynced(_ store: CriaStore, _ table: String, _ localId: String) throws -> String? {
        try store.database.writer.read { connection in
            try String.fetchOne(connection, sql: "SELECT last_synced FROM \(table) WHERE local_id = ?", arguments: [localId])
        }
    }

    func testASecondProjectEditPushedBeforeAPullDoesNotConflictWithTheFirst() async throws {
        let store = try makeStore()
        let localId = try pullProject(store, projectJSON())
        let firstReply = projectJSON(color: "ff0000", updated: "2026-01-02T00:00:00Z")
        let server = StubServer()
        // The pre-push GET sees the original, then (for the second push) the first push's result.
        server.route("GET /projects/5", .init(body: projectJSON()), .init(body: firstReply))
        server.route("POST /projects/5", .init(body: firstReply), .init(body: projectJSON(title: "Mine", color: "ff0000")))
        var colour = ProjectPatch()
        colour.hexColor = .set("ff0000")
        try store.updateProject(localId: localId, patch: colour)
        await drain(store, server)
        XCTAssertEqual(try lastSynced(store, "projects", localId), firstReply, "the reply is the new baseline")
        try store.updateProject(localId: localId, patch: ProjectPatch(title: "Mine"))
        await drain(store, server)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        XCTAssertEqual(server.requests.filter { $0.httpMethod == "POST" }.count, 2)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects WHERE dirty = 1"), 0)
    }

    func testASecondLabelEditPushedBeforeAPullDoesNotConflictWithTheFirst() async throws {
        let store = try makeStore()
        let localId = try pullLabel(store, labelJSON())
        let firstReply = labelJSON(color: "00ff00")
        let server = StubServer()
        server.route("GET /labels/7", .init(body: labelJSON()), .init(body: firstReply))
        server.route("POST /labels/7", .init(body: firstReply), .init(body: labelJSON(title: "Mine", color: "00ff00")))
        try runSQL(store, "UPDATE labels SET hex_color = '00ff00', dirty = 1 WHERE local_id = ?", [localId])
        try enqueueRaw(store, .label, localId: localId, op: .update)
        await drain(store, server)
        XCTAssertEqual(try lastSynced(store, "labels", localId), firstReply)
        try runSQL(store, "UPDATE labels SET title = 'Mine', dirty = 1 WHERE local_id = ?", [localId])
        try enqueueRaw(store, .label, localId: localId, op: .update)
        await drain(store, server)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        XCTAssertEqual(server.requests.filter { $0.httpMethod == "POST" }.count, 2)
    }

    func testALabelCreateStoresTheReplyAsTheBaseline() async throws {
        let store = try makeStore()
        let localId = try store.createLabel(title: "Home").localId
        let reply = #"{"id": 12, "title": "Home", "hex_color": "", "updated": "2026-06-11T10:00:00Z"}"#
        let server = StubServer()
        server.json("PUT /labels", reply)
        await drain(store, server)
        XCTAssertEqual(try lastSynced(store, "labels", localId), reply)
    }

    func testThePrePushCheckCoversEveryEditableField() async throws {
        let (store, localId) = try editedProject()
        let server = StubServer()
        server.json("GET /projects/5", projectJSON(color: "0000ff"))
        await drain(store, server)
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        XCTAssertEqual(conflict.entityLocalId, localId)
        XCTAssertEqual(conflict.fields, ["hex_color"])
        XCTAssertFalse(server.requests.contains { $0.httpMethod == "POST" }, "the push waits for the user")
    }
}
