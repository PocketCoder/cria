import XCTest
@testable import CriaKit

final class ProjectSettingsTests: XCTestCase {
    @discardableResult
    private func pull(
        _ store: CriaStore, id: Int, title: String, parent: Int = 0, identifier: String? = nil, archived: Bool = false
    ) throws -> String {
        let identifierJSON = identifier.map { "\"\($0)\"" } ?? "null"
        let json = """
        {"id": \(id), "title": "\(title)", "parent_project_id": \(parent), "identifier": \(identifierJSON),
         "is_archived": \(archived), "updated": "2026-06-09T10:00:00Z"}
        """
        return try XCTUnwrap(try store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json))
    }

    // MARK: identifier

    func testCreateStoresAnUppercaseTrimmedIdentifierAndQueuesIt() throws {
        let store = try makeStore()
        let created = try store.createProject(ProjectInput(title: "Work", identifier: "  wrk "))
        XCTAssertEqual(created.identifier, "WRK")
        let entries = try outboxEntries(store, entity: "project")
        XCTAssertEqual(try payloadObject(entries[0])["identifier"] as? String, "WRK")
        XCTAssertEqual(try ProjectExecutor().body(created, store: store)["identifier"], .string("WRK"))
    }

    func testIdentifierOverTenCharactersIsRefusedAndNothingIsQueued() throws {
        let store = try makeStore()
        XCTAssertNoThrow(try store.createProject(ProjectInput(title: "Ten", identifier: "ABCDEFGHIJ")))
        XCTAssertThrowsError(try store.createProject(ProjectInput(title: "Eleven", identifier: "ABCDEFGHIJK"))) {
            XCTAssertEqual($0 as? ProjectValidationError, .identifierTooLong)
        }
        XCTAssertEqual(try store.projects().count, 1)
        XCTAssertEqual(try outboxEntries(store, entity: "project").count, 1)
    }

    func testIdentifierMustBeUniqueIgnoringCase() throws {
        let store = try makeStore()
        try pull(store, id: 1, title: "Taken", identifier: "ABC")
        let other = try pull(store, id: 2, title: "Other")
        var patch = ProjectPatch()
        patch.identifier = .set("abc")
        XCTAssertThrowsError(try store.updateProject(localId: other, patch: patch)) {
            XCTAssertEqual($0 as? ProjectValidationError, .identifierNotUnique("ABC"))
        }
        XCTAssertThrowsError(try store.createProject(ProjectInput(title: "New", identifier: "Abc")))
        XCTAssertNil(try store.project(localId: other)?.identifier)
    }

    func testEditKeepsOwnIdentifierAndCanClearIt() throws {
        let store = try makeStore()
        let local = try pull(store, id: 1, title: "Mine", identifier: "MINE")
        var rename = ProjectPatch(title: "Renamed")
        rename.identifier = .set("mine")
        XCTAssertEqual(try store.updateProject(localId: local, patch: rename).identifier, "MINE")

        var clear = ProjectPatch()
        clear.identifier = .set("  ")
        let cleared = try store.updateProject(localId: local, patch: clear)
        XCTAssertNil(cleared.identifier)
        // The push still names the field, empty, so the server cannot read the omission as "leave it".
        XCTAssertEqual(try ProjectExecutor().body(cleared, store: store)["identifier"], .string(""))
    }

    func testUpdateWithoutAnIdentifierChangeLeavesItAlone() throws {
        let store = try makeStore()
        let local = try pull(store, id: 1, title: "Mine", identifier: "MINE")
        let updated = try store.updateProject(localId: local, patch: ProjectPatch(title: "Other"))
        XCTAssertEqual(updated.identifier, "MINE")
        XCTAssertEqual(try ProjectExecutor().body(updated, store: store)["identifier"], .string("MINE"))
    }

    // MARK: parent checks

    func testProjectCannotBeItsOwnParentOrUnderItsDescendant() throws {
        let store = try makeStore()
        let root = try pull(store, id: 1, title: "Root")
        let child = try pull(store, id: 2, title: "Child", parent: 1)
        let grandchild = try pull(store, id: 3, title: "Grandchild", parent: 2)

        var patch = ProjectPatch()
        patch.parentLocalId = .set(root)
        XCTAssertThrowsError(try store.updateProject(localId: root, patch: patch)) {
            XCTAssertEqual($0 as? ProjectValidationError, .parentIsSelf)
        }
        for descendant in [child, grandchild] {
            patch.parentLocalId = .set(descendant)
            XCTAssertThrowsError(try store.updateProject(localId: root, patch: patch)) {
                XCTAssertEqual($0 as? ProjectValidationError, .parentIsDescendant)
            }
        }
        XCTAssertNil(try store.project(localId: root)?.parentLocalId)
        XCTAssertEqual(try outboxEntries(store, entity: "project").count, 0)

        // A sibling branch is fine.
        let other = try pull(store, id: 4, title: "Other")
        patch.parentLocalId = .set(other)
        XCTAssertEqual(try store.updateProject(localId: grandchild, patch: patch).parentLocalId, other)
    }

    func testValidParentsExcludeSelfDescendantsAndArchived() throws {
        let store = try makeStore()
        let root = try pull(store, id: 1, title: "Root")
        let child = try pull(store, id: 2, title: "Child", parent: 1)
        let sibling = try pull(store, id: 3, title: "Sibling")
        let archived = try pull(store, id: 4, title: "Archived", archived: true)
        let all = try store.projects()

        XCTAssertEqual(Set(ProjectTree.validParents(for: root, in: all).map(\.localId)), [sibling])
        XCTAssertEqual(Set(ProjectTree.validParents(for: child, in: all).map(\.localId)), [root, sibling])
        XCTAssertEqual(Set(ProjectTree.validParents(for: nil, in: all).map(\.localId)), [root, child, sibling])
        // An archived parent that is already the current one stays listed so the picker can show it.
        XCTAssertTrue(ProjectTree.validParents(for: child, in: all, keeping: archived).contains { $0.localId == archived })
    }

    func testArchivedParentIsRefusedWhenChosenButNotWhenUntouched() throws {
        let store = try makeStore()
        let archived = try pull(store, id: 1, title: "Old", archived: true)
        let under = try pull(store, id: 2, title: "Under", parent: 1, archived: true)
        let free = try pull(store, id: 3, title: "Free")

        XCTAssertThrowsError(try store.createProject(ProjectInput(title: "Sub", parentLocalId: archived))) {
            XCTAssertEqual($0 as? ProjectValidationError, .parentArchived)
        }
        var move = ProjectPatch()
        move.parentLocalId = .set(archived)
        XCTAssertThrowsError(try store.updateProject(localId: free, patch: move))

        // Renaming a project that already sits under an archived parent is fine, as upstream.
        XCTAssertEqual(try store.updateProject(localId: under, patch: ProjectPatch(title: "Renamed")).title, "Renamed")
        // Unarchiving it while the parent is archived is not.
        XCTAssertThrowsError(try store.updateProject(localId: under, patch: ProjectPatch(isArchived: false))) {
            XCTAssertEqual($0 as? ProjectValidationError, .parentArchived)
        }
    }

    func testCreatingASubProjectQueuesItsParent() throws {
        let store = try makeStore()
        let parent = try pull(store, id: 1, title: "Parent")
        let sub = try store.createProject(ProjectInput(title: "Sub", parentLocalId: parent))
        XCTAssertEqual(sub.parentLocalId, parent)
        XCTAssertEqual(try ProjectExecutor().body(sub, store: store)["parent_project_id"], .number(1))
    }

    // MARK: push body

    func testMovingToTheTopLevelSendsAnExplicitZeroParent() throws {
        let store = try makeStore()
        try pull(store, id: 1, title: "Parent")
        let child = try pull(store, id: 2, title: "Child", parent: 1)
        var patch = ProjectPatch()
        patch.parentLocalId = .set(nil)
        let moved = try store.updateProject(localId: child, patch: patch)
        XCTAssertNil(moved.parentLocalId)
        XCTAssertEqual(try ProjectExecutor().body(moved, store: store)["parent_project_id"], .number(0))
    }

    func testTopLevelAndInvisibleParentProjectsDoNotSendAParent() throws {
        let store = try makeStore()
        let top = try pull(store, id: 1, title: "Top")
        // The server says this one has a parent (99) that this account cannot see, so it is not here to detach from.
        let shared = try pull(store, id: 2, title: "Shared", parent: 99)
        let record = try XCTUnwrap(try store.project(localId: top))
        XCTAssertNil(try ProjectExecutor().body(record, store: store)["parent_project_id"])
        let sharedRecord = try XCTUnwrap(try store.project(localId: shared))
        XCTAssertNil(try ProjectExecutor().body(sharedRecord, store: store)["parent_project_id"])
    }

    func testBodyCarriesTheWholeProject() throws {
        let store = try makeStore()
        let local = try pull(store, id: 1, title: "Full", identifier: "FULL")
        var patch = ProjectPatch(title: "Full", isArchived: false)
        patch.description = .set("About")
        patch.hexColor = .set("#ff0000")
        let record = try store.updateProject(localId: local, patch: patch)
        let body = try ProjectExecutor().body(record, store: store)
        XCTAssertEqual(body["title"], .string("Full"))
        XCTAssertEqual(body["description"], .string("About"))
        XCTAssertEqual(body["hex_color"], .string("ff0000"))
        XCTAssertEqual(body["identifier"], .string("FULL"))
        XCTAssertEqual(body["is_archived"], .bool(false))
        XCTAssertEqual(body["is_favorite"], .bool(false))
    }
}
